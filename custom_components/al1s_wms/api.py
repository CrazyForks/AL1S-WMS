"""Small read-only client for the AL1S WMS HTTP API."""

from __future__ import annotations

from urllib.parse import quote

from .snapshot import build_details

from aiohttp import ClientError, ClientSession, ClientTimeout


class AL1SAPIError(Exception):
    """The AL1S server could not return usable data."""


class AL1SAuthError(AL1SAPIError):
    """The token is invalid or cannot access this household."""


class AL1SClient:
    """Use a Home Assistant managed HTTP session."""

    def __init__(self, session: ClientSession, url: str, token: str) -> None:
        self.session = session
        self.url = url.rstrip("/")
        self.token = token

    async def get(self, path: str, params: dict | None = None):
        try:
            async with self.session.get(
                f"{self.url}/api/v1{path}",
                params=params,
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=ClientTimeout(total=15),
            ) as response:
                if response.status in (401, 403):
                    raise AL1SAuthError("Token is invalid or has no access")
                if response.status >= 400:
                    raise AL1SAPIError(f"AL1S returned HTTP {response.status}")
                return await response.json()
        except (ClientError, TimeoutError, ValueError) as error:
            raise AL1SAPIError("Cannot reach AL1S WMS") from error

    async def homes(self) -> list[dict]:
        result = await self.get("/homes")
        if not isinstance(result, list) or any(
            not isinstance(home, dict) or not isinstance(home.get("id"), str)
            or not isinstance(home.get("name"), str) for home in result
        ):
            raise AL1SAPIError("Invalid household response")
        return result

    async def snapshot(self, home_id: str) -> dict:
        path = f"/homes/{quote(home_id, safe='')}"
        overview = await self.get(f"{path}/overview", {"limit": 50})
        items = await self.get(f"{path}/items")
        if not isinstance(overview, dict) or not isinstance(items, list):
            raise AL1SAPIError("Invalid inventory response")
        for key in ("needsReplenishment", "expiring", "expired", "shopping"):
            section = overview.get(key)
            if not isinstance(section, dict) or not isinstance(section.get("total"), int):
                raise AL1SAPIError("Invalid overview response")
        if any(
            not isinstance(item, dict) or not isinstance(item.get("id"), str)
            or not isinstance(item.get("name"), str)
            or not isinstance(item.get("baseUnit"), str)
            or not isinstance(item.get("quantity"), (int, float)) for item in items
        ):
            raise AL1SAPIError("Invalid item response")
        batches = await self.batches(path)
        opened = await self.get(f"{path}/opened-consumables")
        shopping = await self.get(f"{path}/shopping-list")
        if not isinstance(opened, list) or not isinstance(shopping, list):
            raise AL1SAPIError("Invalid inventory details")
        try:
            details = build_details(overview, items, batches, opened, shopping, self.url)
        except (KeyError, TypeError, ValueError) as error:
            raise AL1SAPIError("Invalid inventory details") from error
        return {"overview": overview, "items": items, "batches": batches, "details": details, "url": self.url}

    async def batches(self, path: str) -> list[dict]:
        """Read every nonempty batch; never silently truncate at the first page."""
        rows = []
        offset = 0
        while True:
            page = await self.get(f"{path}/batches", {"limit": 100, "offset": offset})
            if not isinstance(page, dict) or not isinstance(page.get("items"), list):
                raise AL1SAPIError("Invalid batch response")
            rows.extend(page["items"])
            next_offset = page.get("nextOffset")
            if next_offset is None:
                return rows
            if not isinstance(next_offset, int) or next_offset <= offset:
                raise AL1SAPIError("Invalid batch pagination")
            offset = next_offset
