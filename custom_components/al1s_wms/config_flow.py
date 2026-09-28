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
                if len(homes) != 1 or homes[0].get("id") != entry.data[CONF_HOME_ID]:
                    errors["base"] = "home_token_required"
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
                    if len(homes) != 1:
                        errors["base"] = "home_token_required"
                    else:
                        home = homes[0]
                        try:
                            await client.snapshot(home["id"])
                        except AL1SAuthError:
                            errors["base"] = "invalid_auth"
                        except AL1SAPIError:
                            errors["base"] = "cannot_connect"
                        else:
                            await self.async_set_unique_id(f"{url}|{home['id']}")
                            self._abort_if_unique_id_configured()
                            return self.async_create_entry(
                                title=home["name"],
                                data={CONF_URL: url, CONF_TOKEN: token, CONF_HOME_ID: home["id"]},
                            )

        schema = vol.Schema({
            vol.Required(CONF_URL): str,
            vol.Required(CONF_TOKEN): str,
        })
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)
