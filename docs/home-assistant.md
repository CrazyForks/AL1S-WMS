# Home Assistant dashboard

Each household has six summary sensors: **item types, low-stock items, expiring batches, expired batches, pending shopping items, and items in use**. Individual quantity sensors are created only for items you choose to follow.

Under **Settings → Devices & services → AL1S WMS → Configure**, search and select followed items. Each selection adds one quantity sensor. New inventory items are not followed automatically. Unfollowing disables the entity; following again restores its original entity ID. Entities you disabled yourself must still be enabled manually.

After upgrading from the previous integration, automatically created item entities are disabled. Follow those items again to restore entities referenced by your automations.

## Native cards

No extra card installation is required. Add native **Entities** or **Tile** cards for household summaries and followed items. A **History graph** can show quantity changes.

Add native **Markdown** cards for detail lists. Replace the example entity IDs below with the actual IDs from **Developer tools → States**. HA assigns entity IDs; they may differ from these examples.

### Use soon

```yaml
type: markdown
title: Use soon
content: |-
  {% set entity = 'sensor.home_expiring_batches' %}
  {% if states(entity) in ['unknown', 'unavailable'] %}
  Inventory data is unavailable.
  {% else %}
  {% for item in state_attr(entity, 'items') or [] %}
  - [{{ item.name }}]({{ item.url }}) · {{ item.quantity }} {{ item.unit }} · {{ item.location or 'No location' }} · {{ item.days_remaining }} days left
  {% else %}
  Nothing expires in the next 30 days.
  {% endfor %}
  {% endif %}
```

### In use

```yaml
type: markdown
title: In use
content: |-
  {% set entity = 'sensor.home_items_in_use' %}
  {% if states(entity) in ['unknown', 'unavailable'] %}
  Inventory data is unavailable.
  {% else %}
  {% for item in state_attr(entity, 'items') or [] %}
  - [{{ item.name }}]({{ item.url }}) · {{ item.quantity }} {{ item.unit }} · {{ item.location or 'No location' }} · Opened {{ item.opened_at[:10] }}{% if item.days_remaining is not none %} · {% if item.days_remaining < 0 %}Expired {{ -item.days_remaining }} days ago{% else %}{{ item.days_remaining }} days left{% endif %}{% endif %}
  {% else %}
  No items in use.
  {% endfor %}
  {% endif %}
```

### Replenishment

```yaml
type: markdown
title: Replenishment
content: |-
  {% set entity = 'sensor.home_low_stock_items' %}
  {% if states(entity) in ['unknown', 'unavailable'] %}
  Inventory data is unavailable.
  {% else %}
  {% for item in state_attr(entity, 'items') or [] %}
  - [{{ item.name }}]({{ item.url }}) · {{ item.quantity }} {{ item.unit }} left · Buy {{ item.suggested_quantity }} {{ item.unit }}
  {% else %}
  Nothing needs replenishment.
  {% endfor %}
  {% endif %}
```

Combine these in a native **Vertical stack** card with summary tiles above. Item links open AL1S details; your browser must also reach the configured AL1S URL and be signed in to the household.

## State and attributes

Summary states are counts. Detail lists are in their `items` attribute and refresh about once a minute. Expiring and expired counts represent remaining batch/location records: one batch at two locations produces two records. The 30-day expiry window includes today, matching AL1S.

| Summary | Additional detail fields |
| --- | --- |
| Low stock | `reorder_point`, `suggested_quantity` |
| Expiring / expired | `batch_id`, `expiry_date`, `days_remaining` |
| In use | `opened_id`, `batch_id`, `opened_at`, `expiry_date`, `days_remaining` |
| Shopping | `shopping_id`, `source`, `planned_date` |

Common detail fields are `item_id`, `name`, `quantity`, `unit`, and `url`. Batch and opening records also include `location_id` and `location`. Shopping `source` is `manual` or `automatic`. Unknown dates and locations are `null`.

The in-use summary counts **distinct item types**, while its list contains individual opening records. Two opened bottles of the same shampoo can have two records but count as one item type. Effective opened expiry is the earlier of the original expiry date and the opened shelf-life date.

Followed item states are total quantities across locations, using the AL1S unit. Attributes include:

| Attribute | Meaning |
| --- | --- |
| `locations` | Actual locations with stock, each with `location_id`, `name`, `quantity` |
| `needs_replenishment` | Boolean indicating quantity below the reorder point |
| `reorder_point` / `suggested_quantity` | Reorder point / quantity needed to reach it |
| `opened_quantity` / `unopened_quantity` | Opened / unopened quantities in the item's unit |
| `next_expiry_date` | Earliest original expiry among batches still in stock |
| `next_opened_expiry_date` | Earliest effective expiry among opened records |
| `opened` | Opening records for this item |
| `url` | AL1S item detail URL |

Opened stock remains part of total stock until exhaustion is recorded. Opened quantity means inventory units such as bottles, **not the percentage left inside a bottle**. Connection failures make entities unavailable; example cards hide stale lists in that case.

## Automations

Use a followed quantity sensor's `needs_replenishment` attribute as a trigger, and include `suggested_quantity` in a notification. A scheduled automation can read the in-use list's `days_remaining` to send a combined reminder without creating an entity for every bottle.

The integration is read-only: it does not complete shopping tasks, receive purchases, or deduct stock.
