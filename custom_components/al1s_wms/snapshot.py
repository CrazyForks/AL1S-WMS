"""Build compact inventory details without creating per-batch entities."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone


def build_details(overview: dict, items: list, batches: list, opened: list, shopping: list, url: str) -> dict:
    """Use the server snapshot's date and expiry window for consistent summaries."""
    today = datetime.fromisoformat(overview["generatedAt"].replace("Z", "+00:00")).astimezone(timezone.utc).date()
    through = today + timedelta(days=overview["expiryWindow"]["days"])
    by_item = {item["id"]: item for item in items}

    def detail(row: dict) -> dict:
        item_id = row.get("itemId", row.get("id"))
        return {
            "item_id": item_id,
            "name": row.get("itemName", row.get("name")),
            "quantity": row["quantity"],
            "unit": row.get("baseUnit", row.get("unit")),
            "location_id": row.get("locationId"),
            "location": row.get("locationName"),
            "url": f"{url}/items/{item_id}" if item_id in by_item else f"{url}/shopping",
        }

    low_stock = []
    for item in items:
        shortage = round(item["reorderPoint"] - item["quantity"], 2)
        if shortage > 0:
            row = detail(item)
            # An item's default location is not necessarily where its stock is.
            row.pop("location_id")
            row.pop("location")
            row.update(reorder_point=item["reorderPoint"], suggested_quantity=shortage)
            low_stock.append(row)

    expiring, expired = [], []
    for batch in batches:
        if batch["quantity"] <= 0 or not batch.get("expiryDate"):
            continue
        expiry = datetime.fromisoformat(batch["expiryDate"]).date()
        row = detail(batch)
        row.update(batch_id=batch["batchId"], expiry_date=batch["expiryDate"], days_remaining=(expiry - today).days)
        if expiry < today:
            expired.append(row)
        elif expiry <= through:
            expiring.append(row)

    opened_details = []
    for record in opened:
        if record["quantity"] <= 0:
            continue
        dates = [record[key] for key in ("expiryDate", "openedExpiryDate") if record.get(key)]
        effective_expiry = min(dates) if dates else None
        row = detail(record)
        row.update(opened_id=record["id"], batch_id=record["batchId"], opened_at=record["openedAt"], expiry_date=effective_expiry)
        row["days_remaining"] = (datetime.fromisoformat(effective_expiry).date() - today).days if effective_expiry else None
        opened_details.append(row)

    shopping_details = []
    for record in shopping:
        row = detail(record)
        row.update(shopping_id=record["id"], source=record["source"], planned_date=record.get("plannedDate"))
        shopping_details.append(row)

    return {
        "low_stock": low_stock,
        "expiring": sorted(expiring, key=lambda row: row["expiry_date"]),
        "expired": sorted(expired, key=lambda row: row["expiry_date"]),
        "opened": opened_details,
        "shopping": shopping_details,
    }


def item_attributes(data: dict, item: dict) -> dict:
    """Describe actual stock locations and opening status for a followed item."""
    item_id = item["id"]
    opened = [row for row in data["details"]["opened"] if row["item_id"] == item_id]
    batches = [row for row in data["batches"] if row["itemId"] == item_id and row["quantity"] > 0]
    locations = {}
    for batch in batches:
        location_id = batch.get("locationId")
        location = locations.setdefault(location_id, {"location_id": location_id, "name": batch.get("locationName"), "quantity": 0})
        location["quantity"] = round(location["quantity"] + batch["quantity"], 2)
    expiry_dates = [row["expiryDate"] for row in batches if row.get("expiryDate")]
    opened_expiry_dates = [row["expiry_date"] for row in opened if row.get("expiry_date")]
    return {
        "item_id": item_id,
        "reorder_point": item["reorderPoint"],
        "needs_replenishment": round(item["reorderPoint"] - item["quantity"], 2) > 0,
        "suggested_quantity": max(round(item["reorderPoint"] - item["quantity"], 2), 0),
        "locations": list(locations.values()),
        "opened_quantity": round(sum(row["quantity"] for row in opened), 2),
        "unopened_quantity": max(round(item["quantity"] - sum(row["quantity"] for row in opened), 2), 0),
        "next_expiry_date": min(expiry_dates) if expiry_dates else None,
        "next_opened_expiry_date": min(opened_expiry_dates) if opened_expiry_dates else None,
        "opened": opened,
        "url": f"{data['url']}/items/{item_id}",
    }
