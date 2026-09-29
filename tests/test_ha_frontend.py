"""Tests for bundled Home Assistant card resource registration."""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import AsyncMock


ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "al1s_wms"


class StaticPathConfig:
    def __init__(self, url_path: str, path: str, cache_headers: bool) -> None:
        self.url_path = url_path
        self.path = path
        self.cache_headers = cache_headers


class ResourceStorageCollection:
    """Minimal storage-mode resource collection used by the tests."""

    def __init__(self, items: list[dict] | None = None, loaded: bool = True) -> None:
        self._items = list(items or [])
        self.loaded = loaded
        self.next_id = 1
        self.load_count = 0

    def async_items(self) -> list[dict]:
        return list(self._items)

    async def async_load(self) -> None:
        self.load_count += 1
        self.loaded = True

    async def async_get_info(self) -> dict:
        self.loaded = True
        return {"version": 1}

    async def async_create_item(self, data: dict) -> dict:
        item = {"id": str(self.next_id), "type": data["res_type"], "url": data["url"]}
        self.next_id += 1
        self._items.append(item)
        return item

    async def async_update_item(self, item_id: str, data: dict) -> dict:
        item = next(item for item in self._items if item["id"] == item_id)
        item.update(
            {
                "type": data.get("res_type", item["type"]),
                "url": data.get("url", item["url"]),
            }
        )
        return item


class FakeHass:
    def __init__(self, resources: object | None = None) -> None:
        self.data = {} if resources is None else {"lovelace": {"resources": resources}}
        self.http = ModuleType("http")
        self.http.async_register_static_paths = AsyncMock()

    async def async_add_executor_job(self, func, *args):
        return await asyncio.to_thread(func, *args)


def load_frontend_module() -> tuple[
    ModuleType, list[tuple[str, ModuleType | None]], list
]:
    """Load the helper with small Home Assistant API stubs for isolated tests."""
    modules: dict[str, ModuleType] = {}
    for name in (
        "homeassistant",
        "homeassistant.components",
        "homeassistant.components.lovelace",
        "homeassistant.components.lovelace.resources",
        "homeassistant.components.http",
        "homeassistant.core",
        "homeassistant.setup",
    ):
        modules[name] = ModuleType(name)
    modules["homeassistant.components.lovelace"].LOVELACE_DATA = "lovelace"
    modules[
        "homeassistant.components.lovelace.resources"
    ].ResourceStorageCollection = ResourceStorageCollection
    modules["homeassistant.components.http"].StaticPathConfig = StaticPathConfig
    modules["homeassistant.core"].HomeAssistant = object
    callbacks = []
    modules["homeassistant.setup"].async_when_setup_or_start = (
        lambda _hass, _component, callback: callbacks.append(callback)
    )

    prior = [(name, sys.modules.get(name)) for name in modules]
    sys.modules.update(modules)

    package = ModuleType("al1s_wms_frontend_test")
    package.__path__ = [str(COMPONENT)]
    sys.modules[package.__name__] = package
    module_name = f"{package.__name__}.frontend"
    spec = importlib.util.spec_from_file_location(
        module_name, COMPONENT / "frontend.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module, prior + [(package.__name__, None), (module_name, None)], callbacks


class FrontendResourceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.frontend, self.prior_modules, self.callbacks = load_frontend_module()

    def tearDown(self) -> None:
        for name, previous in self.prior_modules:
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous

    async def test_registers_card_without_replacing_existing_resources(self) -> None:
        resources = ResourceStorageCollection(
            [{"id": "existing", "type": "module", "url": "/local/other-card.js"}]
        )
        hass = FakeHass(resources)

        await self.frontend.async_setup_frontend(hass)
        await self.frontend.async_setup_frontend(hass)

        items = resources.async_items()
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["url"], "/local/other-card.js")
        card = items[1]
        self.assertEqual(card["type"], "module")
        self.assertTrue(card["url"].startswith("/al1s_wms/al1s-inventory-card.js?v="))
        hass.http.async_register_static_paths.assert_awaited_once()
        path_config = hass.http.async_register_static_paths.await_args.args[0][0]
        self.assertFalse(path_config.cache_headers)

    async def test_updates_its_existing_resource_when_bundle_changes(self) -> None:
        resources = ResourceStorageCollection(
            [
                {
                    "id": "card",
                    "type": "module",
                    "url": "/al1s_wms/al1s-inventory-card.js?v=old",
                }
            ]
        )
        hass = FakeHass(resources)

        await self.frontend.async_setup_frontend(hass)

        items = resources.async_items()
        self.assertEqual(len(items), 1)
        self.assertNotIn("?v=old", items[0]["url"])

    async def test_loads_existing_storage_before_mutating(self) -> None:
        resources = ResourceStorageCollection(loaded=False)
        hass = FakeHass(resources)

        await self.frontend.async_setup_frontend(hass)

        self.assertEqual(resources.load_count, 1)
        self.assertEqual(len(resources.async_items()), 1)

    async def test_yaml_mode_does_not_mutate_resources(self) -> None:
        class YamlResources:
            def async_items(self) -> list[dict]:
                return []

        resources = YamlResources()
        hass = FakeHass(resources)

        await self.frontend.async_setup_frontend(hass)

        self.assertEqual(resources.async_items(), [])
        self.assertNotIn(self.frontend.FRONTEND_RESOURCE_RETRY_KEY, hass.data)

    async def test_retries_when_lovelace_resources_are_not_ready(self) -> None:
        hass = FakeHass()

        await self.frontend.async_setup_frontend(hass)

        self.assertEqual(len(self.callbacks), 1)
        resources = ResourceStorageCollection()
        hass.data["lovelace"] = {"resources": resources}
        await self.callbacks[0](hass, "lovelace")

        self.assertEqual(len(resources.async_items()), 1)


if __name__ == "__main__":
    unittest.main()
