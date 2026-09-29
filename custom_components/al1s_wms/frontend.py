"""Serve the bundled card and register it as a Lovelace resource."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_when_setup_or_start

from .const import (
    CARD_FILENAME,
    CARD_URL_BASE,
    FRONTEND_RESOURCE_RETRY_KEY,
    FRONTEND_SETUP_KEY,
)

_LOGGER = logging.getLogger(__name__)

try:
    from homeassistant.components.lovelace import LOVELACE_DATA
except ImportError:  # pragma: no cover - compatibility with older Home Assistant
    LOVELACE_DATA = "lovelace"

try:
    from homeassistant.components.lovelace.resources import ResourceStorageCollection
except ImportError:  # pragma: no cover - compatibility with older Home Assistant
    ResourceStorageCollection = type("ResourceStorageCollection", (), {})


def _card_digest(path: Path) -> str:
    """Return a content hash so browser caches follow the bundled file."""
    return hashlib.sha256(path.read_bytes()).hexdigest()[:12]


def _resource_url(digest: str) -> str:
    return f"{CARD_URL_BASE}/{CARD_FILENAME}?v={digest}"


def _lovelace_resources(hass: HomeAssistant) -> Any | None:
    lovelace_data = hass.data.get(LOVELACE_DATA)
    if lovelace_data is None:
        lovelace_data = hass.data.get("lovelace")
    if lovelace_data is None:
        return None
    if isinstance(lovelace_data, dict):
        return lovelace_data.get("resources")
    return getattr(lovelace_data, "resources", None)


def _find_resource(resources: Any, base_url: str) -> dict[str, Any] | None:
    for resource in resources.async_items():
        if str(resource.get("url", "")).partition("?")[0] == base_url:
            return dict(resource)
    return None


async def _async_register_resource(hass: HomeAssistant, url: str) -> bool:
    """Create or update the bundled module in storage-mode Lovelace."""
    resources = _lovelace_resources(hass)
    if resources is None:
        return False

    if not isinstance(resources, ResourceStorageCollection):
        _LOGGER.warning(
            "Lovelace YAML mode cannot auto-register the AL1S WMS card. "
            "Add this module resource manually: %s",
            url.split("?", maxsplit=1)[0],
        )
        return False

    if not getattr(resources, "loaded", True):
        await resources.async_load()
        resources.loaded = True
    else:
        await resources.async_get_info()

    base_url = f"{CARD_URL_BASE}/{CARD_FILENAME}"
    existing = _find_resource(resources, base_url)
    if existing is None:
        await resources.async_create_item({"res_type": "module", "url": url})
        _LOGGER.debug("Registered AL1S WMS Lovelace resource %s", url)
    elif existing.get("url") != url or existing.get("type") != "module":
        await resources.async_update_item(
            existing["id"], {"res_type": "module", "url": url}
        )
        _LOGGER.debug("Updated AL1S WMS Lovelace resource %s", url)
    return True


def _schedule_resource_retry(hass: HomeAssistant, url: str) -> None:
    """Retry once when Lovelace becomes available during startup."""
    if hass.data.get(FRONTEND_RESOURCE_RETRY_KEY):
        return
    hass.data[FRONTEND_RESOURCE_RETRY_KEY] = True

    async def retry(hass_: HomeAssistant, _component: str) -> None:
        if not await _async_register_resource(hass_, url):
            _LOGGER.debug("AL1S WMS Lovelace resource was not registered")

    async_when_setup_or_start(hass, "lovelace", retry)


async def async_setup_frontend(hass: HomeAssistant) -> None:
    """Serve the card and register it once in the user's Lovelace resources."""
    card_directory = Path(__file__).parent / "frontend"
    card_path = card_directory / CARD_FILENAME
    if not await hass.async_add_executor_job(card_path.is_file):
        _LOGGER.error("Bundled AL1S WMS card is missing: %s", card_path)
        return

    if not hass.data.get(FRONTEND_SETUP_KEY):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(CARD_URL_BASE, str(card_directory), cache_headers=False)]
        )
        hass.data[FRONTEND_SETUP_KEY] = True

    digest = await hass.async_add_executor_job(_card_digest, card_path)
    url = _resource_url(digest)
    if await _async_register_resource(hass, url):
        return
    if _lovelace_resources(hass) is None:
        _schedule_resource_retry(hass, url)
