"""Household inventory summary sensors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from homeassistant.components.sensor import SensorEntity
from homeassistant.components.sensor import SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity, DataUpdateCoordinator

from .const import DOMAIN


@dataclass(frozen=True)
class Summary:
    key: str
    label: str
    icon: str
    value: Callable[[dict], int]


SUMMARIES = (
    Summary("items", "物资种类", "mdi:package-variant-closed", lambda data: len(data["items"])),
    Summary("low_stock", "待补货物资", "mdi:cart-arrow-down", lambda data: data["overview"]["needsReplenishment"]["total"]),
    Summary("expiring", "临期批次", "mdi:calendar-alert", lambda data: data["overview"]["expiring"]["total"]),
    Summary("expired", "过期批次", "mdi:calendar-remove", lambda data: data["overview"]["expired"]["total"]),
    Summary("shopping", "待采购项", "mdi:cart-outline", lambda data: data["overview"]["shopping"]["total"]),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Expose household summaries and one quantity sensor per item."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        AL1SSummarySensor(coordinator, entry, summary) for summary in SUMMARIES
    )
    known_items: set[str] = set()

    @callback
    def add_new_items() -> None:
        new_items = [
            item for item in coordinator.data["items"]
            if item["id"] not in known_items
        ]
        if new_items:
            known_items.update(item["id"] for item in new_items)
            async_add_entities(
                AL1SItemSensor(coordinator, entry, item["id"]) for item in new_items
            )

    add_new_items()
    entry.async_on_unload(coordinator.async_add_listener(add_new_items))


class AL1SSummarySensor(CoordinatorEntity, SensorEntity):
    """Read a single count from the latest AL1S snapshot."""

    _attr_has_entity_name = True
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(
        self, coordinator: DataUpdateCoordinator, entry: ConfigEntry, summary: Summary
    ) -> None:
        super().__init__(coordinator)
        self.summary = summary
        self._attr_unique_id = f"{entry.unique_id}_{summary.key}"
        self._attr_translation_key = summary.key
        self._attr_icon = summary.icon
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, str(entry.unique_id))},
            name=entry.title,
            manufacturer="AL1S WMS",
            model="Household inventory",
            configuration_url=entry.data["url"],
        )

    @property
    def native_value(self) -> int:
        """Return the count from the last successful refresh."""
        return self.summary.value(self.coordinator.data)


class AL1SItemSensor(CoordinatorEntity, SensorEntity):
    """Current quantity for one item, aggregated across locations."""

    _attr_has_entity_name = True
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:package-variant"

    def __init__(
        self, coordinator: DataUpdateCoordinator, entry: ConfigEntry, item_id: str
    ) -> None:
        super().__init__(coordinator)
        self.item_id = item_id
        self._attr_unique_id = f"{entry.unique_id}_item_{item_id}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, str(entry.unique_id))},
            name=entry.title,
            manufacturer="AL1S WMS",
            model="Household inventory",
            configuration_url=entry.data["url"],
        )

    @property
    def item(self) -> dict | None:
        """Look up the latest item data after each coordinator refresh."""
        return next(
            (item for item in self.coordinator.data["items"] if item["id"] == self.item_id),
            None,
        )

    @property
    def available(self) -> bool:
        return super().available and self.item is not None

    @property
    def name(self) -> str | None:
        return self.item["name"] if self.item else None

    @property
    def native_unit_of_measurement(self) -> str | None:
        return self.item.get("baseUnit") if self.item else None

    @property
    def native_value(self) -> float | None:
        return self.item["quantity"] if self.item else None
