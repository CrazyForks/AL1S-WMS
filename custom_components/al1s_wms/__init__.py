"""Home Assistant integration for AL1S WMS households."""

from __future__ import annotations

from datetime import timedelta
import logging
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_URL, Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import AL1SAPIError, AL1SAuthError, AL1SClient
from .const import CONF_HOME_ID, CONF_TOKEN, DOMAIN, SCAN_INTERVAL_SECONDS

PLATFORMS = [Platform.SENSOR]
_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Ship and load the dashboard card with the integration."""
    await hass.http.async_register_static_paths([
        StaticPathConfig("/al1s_wms/al1s-inventory-card.js", str(Path(__file__).parent / "frontend" / "al1s-inventory-card.js"), True),
    ])
    frontend.add_extra_js_url(hass, "/al1s_wms/al1s-inventory-card.js?v=0.0.4")
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the selected household and register its entities."""
    client = AL1SClient(
        async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_TOKEN]
    )

    async def fetch():
        try:
            return await client.snapshot(entry.data[CONF_HOME_ID])
        except AL1SAuthError as error:
            raise ConfigEntryAuthFailed("AL1S token is no longer authorized") from error
        except AL1SAPIError as error:
            raise UpdateFailed(str(error)) from error

    coordinator = DataUpdateCoordinator(
        hass,
        logger=_LOGGER,
        name=f"AL1S WMS {entry.title}",
        update_method=fetch,
        update_interval=timedelta(seconds=SCAN_INTERVAL_SECONDS),
    )
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a household."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True
