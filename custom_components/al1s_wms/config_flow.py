"""UI setup for AL1S WMS."""

from __future__ import annotations

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_URL
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import AL1SAPIError, AL1SAuthError, AL1SClient
from .const import CONF_FOLLOWED_ITEMS, CONF_HOME_ID, CONF_TOKEN, DOMAIN


class AL1SConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Set up one household per entry."""

    VERSION = 1
    _url: str
    _token: str
    _homes: list[dict]

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return AL1SOptionsFlow()

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
                    snapshot = await client.snapshot(home_id)
                except AL1SAuthError:
                    errors["base"] = "invalid_auth"
                except AL1SAPIError:
                    errors["base"] = "cannot_connect"
                else:
                    await self.async_set_unique_id(f"{self._url}|{home_id}")
                    self._abort_if_unique_id_configured()
                    self._home = home
                    self._items = snapshot["items"]
                    return await self.async_step_follow()
        choices = {home["id"]: home["name"] for home in self._homes}
        schema = vol.Schema({vol.Required(CONF_HOME_ID): vol.In(choices)})
        return self.async_show_form(step_id="home", data_schema=schema, errors=errors)

    async def async_step_follow(self, user_input=None):
        """No individual item is exposed unless selected."""
        if user_input is not None:
            allowed = {item["id"] for item in self._items}
            selected = [item_id for item_id in user_input.get(CONF_FOLLOWED_ITEMS, []) if item_id in allowed]
            return self.async_create_entry(
                title=self._home["name"],
                data={CONF_URL: self._url, CONF_TOKEN: self._token, CONF_HOME_ID: self._home["id"]},
                options={CONF_FOLLOWED_ITEMS: selected},
            )
        return self.async_show_form(step_id="follow", data_schema=follow_schema(self._items, []))


def follow_schema(items: list[dict], selected: list[str]) -> vol.Schema:
    """Searchable multi-select with stable item IDs and readable labels."""
    allowed = {item["id"] for item in items}
    return vol.Schema({
        vol.Optional(CONF_FOLLOWED_ITEMS, default=[item_id for item_id in selected if item_id in allowed]): selector.SelectSelector(
            selector.SelectSelectorConfig(
                options=[{"value": item["id"], "label": f"{item['name']} · {item['baseUnit']}"} for item in items],
                multiple=True,
                mode=selector.SelectSelectorMode.DROPDOWN,
            )
        ),
    })


class AL1SOptionsFlow(config_entries.OptionsFlow):
    """Change followed items without reconnecting the household."""

    async def async_step_init(self, user_input=None):
        errors = {}
        entry = self.config_entry
        client = AL1SClient(async_get_clientsession(self.hass), entry.data[CONF_URL], entry.data[CONF_TOKEN])
        try:
            snapshot = await client.snapshot(entry.data[CONF_HOME_ID])
        except AL1SAuthError:
            errors["base"] = "invalid_auth"
        except AL1SAPIError:
            errors["base"] = "cannot_connect"
        else:
            items = snapshot["items"]
            if user_input is not None:
                allowed = {item["id"] for item in items}
                selected = [item_id for item_id in user_input.get(CONF_FOLLOWED_ITEMS, []) if item_id in allowed]
                return self.async_create_entry(title="", data={**entry.options, CONF_FOLLOWED_ITEMS: selected})
            return self.async_show_form(
                step_id="init",
                data_schema=follow_schema(items, entry.options.get(CONF_FOLLOWED_ITEMS, [])),
            )
        return self.async_show_form(step_id="init", data_schema=vol.Schema({}), errors=errors)
