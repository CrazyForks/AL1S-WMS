"""UI setup for AL1S WMS."""

from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_URL
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import AL1SAPIError, AL1SAuthError, AL1SClient
from .const import CONF_HOME_ID, CONF_TOKEN, DOMAIN


class AL1SConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Set up one household per entry."""

    VERSION = 1
    _url: str
    _token: str
    _homes: list[dict]

    async def async_step_reauth(self, entry_data):
        """Replace an expired or revoked household token."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input=None):
        """Check the replacement token before storing it."""
        entry = self._get_reauth_entry()
        errors = {}
        if user_input is not None:
            token = user_input[CONF_TOKEN].strip()
            client = AL1SClient(async_get_clientsession(self.hass), entry.data[CONF_URL], token)
            try:
                homes = await client.homes()
            except AL1SAuthError:
                errors["base"] = "invalid_auth"
            except AL1SAPIError:
                errors["base"] = "cannot_connect"
            else:
                if not any(home["id"] == entry.data[CONF_HOME_ID] for home in homes):
                    errors["base"] = "home_access_required"
                else:
                    try:
                        await client.snapshot(entry.data[CONF_HOME_ID])
                    except AL1SAuthError:
                        errors["base"] = "invalid_auth"
                    except AL1SAPIError:
                        errors["base"] = "cannot_connect"
                    else:
                        return self.async_update_reload_and_abort(
                            entry, data_updates={CONF_TOKEN: token}
                        )
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_TOKEN): str}),
            errors=errors,
        )

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            token = user_input[CONF_TOKEN].strip()
            if not url.startswith(("http://", "https://")):
                errors["base"] = "invalid_url"
            else:
                client = AL1SClient(async_get_clientsession(self.hass), url, token)
                try:
                    homes = await client.homes()
                except AL1SAuthError:
                    errors["base"] = "invalid_auth"
                except AL1SAPIError:
                    errors["base"] = "cannot_connect"
                else:
                    if not homes:
                        errors["base"] = "no_homes"
                    else:
                        self._url = url
                        self._token = token
                        self._homes = homes
                        return await self.async_step_home()

        schema = vol.Schema({
            vol.Required(CONF_URL): str,
            vol.Required(CONF_TOKEN): str,
        })
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_home(self, user_input=None):
        """Bind this config entry to exactly one chosen household."""
        if not hasattr(self, "_homes"):
            return await self.async_step_user()
        errors = {}
        if user_input is not None:
            home_id = user_input[CONF_HOME_ID]
            home = next((row for row in self._homes if row["id"] == home_id), None)
            if home is None:
                errors["base"] = "home_access_required"
            else:
                client = AL1SClient(async_get_clientsession(self.hass), self._url, self._token)
                try:
                    await client.snapshot(home_id)
                except AL1SAuthError:
                    errors["base"] = "invalid_auth"
                except AL1SAPIError:
                    errors["base"] = "cannot_connect"
                else:
                    await self.async_set_unique_id(f"{self._url}|{home_id}")
                    self._abort_if_unique_id_configured()
                    return self.async_create_entry(
                        title=home["name"],
                        data={CONF_URL: self._url, CONF_TOKEN: self._token, CONF_HOME_ID: home_id},
                    )
        choices = {home["id"]: home["name"] for home in self._homes}
        schema = vol.Schema({vol.Required(CONF_HOME_ID): vol.In(choices)})
        return self.async_show_form(step_id="home", data_schema=schema, errors=errors)
