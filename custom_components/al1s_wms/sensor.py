"""Household inventory summary sensors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass
from homeassistant.components.sensor import SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.update_coordinator import CoordinatorEntity, DataUpdateCoordinator

from .const import DOMAIN
from .snapshot import attention_rows


@dataclass(frozen=True)
class Summary:
    key: str
    label: str
    icon: str
    value: Callable[[dict], int]


SUMMARIES = (
    Summary("items", "物资种类", "mdi:package-variant-closed", lambda data: len(data["items"])),
    Summary("low_stock", "待补货物资", "mdi:cart-arrow-down", lambda data: len(data["details"]["low_stock"])),
    Summary("expiring", "临期批次", "mdi:calendar-alert", lambda data: len(data["details"]["expiring"])),
    Summary("expired", "过期批次", "mdi:calendar-remove", lambda data: len(data["details"]["expired"])),
    Summary("shopping", "待采购项", "mdi:cart-outline", lambda data: len(data["details"]["shopping"])),
    Summary("opened", "使用中物资", "mdi:bottle-tonic-outline", lambda data: len({row["item_id"] for row in data["details"]["opened"]})),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Expose household detail entities without individual item setup."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        AL1SSummarySensor(coordinator, entry, summary) for summary in SUMMARIES
    )
    async_add_entities((AL1SDetailSensor(coordinator, entry, key) for key in ("attention", "opened_details")))
    registry = er.async_get(hass)
    prefix = f"{entry.unique_id}_item_"
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.unique_id.startswith(prefix) and entity.disabled_by is None:
            registry.async_update_entity(entity.entity_id, disabled_by=er.RegistryEntryDisabler.INTEGRATION)


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

    @property
    def extra_state_attributes(self) -> dict | None:
        """Expose full detail lists for dashboard templates and automations."""
        if self.summary.key == "items":
            return None
        attributes = {"items": self.coordinator.data["details"][self.summary.key]}
        if self.summary.key == "expiring":
            attributes["expiry_window_days"] = self.coordinator.data["overview"]["expiryWindow"]["days"]
        return attributes


class AL1SDetailSensor(CoordinatorEntity, SensorEntity):
    """A small textual state with all rows in structured attributes."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: DataUpdateCoordinator, entry: ConfigEntry, key: str) -> None:
        super().__init__(coordinator)
        self.key = key
        self.household = entry.entry_id
        self.household_name = entry.title
        self._attr_device_class = SensorDeviceClass.ENUM
        self._attr_options = ["needs_attention", "clear"] if key == "attention" else ["in_use", "none"]
        self._attr_unique_id = f"{entry.unique_id}_{key}"
        self._attr_translation_key = key
        self._attr_icon = "mdi:alert-circle-outline" if key == "attention" else "mdi:bottle-tonic-outline"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, str(entry.unique_id))},
            name=entry.title,
            manufacturer="AL1S WMS",
            model="Household inventory",
            configuration_url=entry.data["url"],
        )

    @property
    def rows(self) -> list[dict]:
        details = self.coordinator.data["details"]
        return attention_rows(details) if self.key == "attention" else details["opened"]

    @property
    def native_value(self) -> str:
        if self.key == "attention":
            return "needs_attention" if self.rows else "clear"
        return "in_use" if self.rows else "none"

    @property
    def extra_state_attributes(self) -> dict:
        details = self.coordinator.data["details"]
        shared = {"integration": DOMAIN, "detail_type": self.key, "household": self.household, "household_name": self.household_name}
        if self.key == "opened_details":
            return {**shared, "items": self.rows, "count": len(self.rows)}
        return {
            **shared,
            "items": self.rows,
            "count": len(self.rows),
            "out_of_stock_count": sum(row["status"] == "out_of_stock" for row in self.rows),
            "low_stock_count": sum(row["status"] == "low_stock" for row in self.rows),
            "critical_count": len(details["critical"]),
            "expiring_count": len(details["expiring"]),
            "expired_count": len(details["expired"]),
            "expiry_window_days": self.coordinator.data["overview"]["expiryWindow"]["days"],
        }
