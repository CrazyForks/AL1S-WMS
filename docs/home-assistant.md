# Home Assistant inventory card

The integration bundles an **AL1S WMS inventory card** and loads it automatically. No separate frontend resource, Markdown templates, or item selection is required.

## Add the card

1. Update AL1S WMS through HACS to **v0.0.4 or newer**, restart Home Assistant, and refresh your browser.
2. In your dashboard, select **Edit → Add card** and search for **AL1S WMS**.
3. Select a household in the visual editor and save. You can change the title or show only inventory attention or opened items.

The card reads two household detail entities and updates with their minute-by-minute refresh. It makes no additional AL1S requests and creates no per-item entities. If the card is missing, configure the integration's household and reload the HA webpage.

## What it shows

**Inventory attention**: a table of out-of-stock, low-stock, at-threshold, expiring and expired items, with names, quantities, and replenishment or expiry details. Filter by status.

**In use**: a table of individual opening records with item name, quantity, actual location, opening date and effective expiry. Opening dates appear below the item name to save horizontal space.

The card follows HA's light or dark theme and language (English or Chinese). On narrow screens, tables scroll within the card. Item links open AL1S details; your browser must reach AL1S and be signed in to the household.

## Entities and data

| Entity | State | Details |
| --- | --- | --- |
| Inventory attention | `needs_attention` / `clear` | `items` contains all issue records, including status, name, quantity and batch details |
| Opened items | `in_use` / `none` | `items` contains all opening records, including name, quantity, location and dates |

The previous six numeric summary sensors remain available. Older per-item entities are disabled, retaining their IDs and history; automations referencing them should migrate to detail attributes. On connection failure, entities become unavailable and the card hides stale records.

Out of stock means zero inventory. Low stock means positive inventory below the reorder point. At threshold means positive inventory equal to it. Zero stock with a zero reorder point is listed as out of stock, but has no suggested replenishment quantity. Expiry rows represent remaining batch/location records in the next 30 days. An item can have both a replenishment and an expiry issue; a batch at multiple locations also produces multiple records.

Opened quantity remains part of total stock until exhaustion is recorded. A bottle count is not the percentage remaining inside it. Effective opened expiry is the earlier of original expiry and opened shelf-life expiry. Unknown dates display as “Not set”.

Attention rows contain `status`, `item_id`, `name`, `quantity`, `unit`, and `url`. Replenishment rows add `reorder_point` and `suggested_quantity`; expiry rows add `batch_id`, `expiry_date`, `days_remaining`, `location_id`, and `location`. Opening rows include `opened_id`, `opened_at`, expiry, item and location details. These attributes are also available to HA automations.

The YAML type is `custom:al1s-inventory-card`; normally the visual editor is sufficient. The integration is read-only and does not alter stock.
