# AL1S WMS in Home Assistant

Connect a household inventory to Home Assistant to view stock issues and opened items on a dashboard, or use inventory status in automations.

## Install and connect

1. In AL1S WMS, open **Settings → MCP access tokens** and create a token for the household you want to connect. Copy the token and the AL1S address, for example `http://192.168.1.20:8080`.
2. In Home Assistant, open **HACS → Integrations → ⋮ → Custom repositories**. Add `https://github.com/RicterZ/AL1S-WMS` and choose **Integration**. Download AL1S WMS and restart Home Assistant.
3. Go to **Settings → Devices & services → Add integration**, search for **AL1S WMS**, then enter the AL1S address and token. Select the household to connect.

Home Assistant must be able to reach the AL1S address. If Home Assistant runs in a container, use the address of the AL1S host or a shared service name, not `localhost`.

## Add the dashboard card

1. Open a dashboard and choose **Edit dashboard → Add card**.
2. Search for **AL1S WMS**.
3. Add **Inventory attention** or **In use** as needed. You can place the two cards separately on the dashboard.
4. Choose the household to display in the card configuration.

**Inventory attention** lists out-of-stock, low-stock, at-threshold, expiring, and expired items. Expiring means the batch expires within 30 days.

**In use** lists opened records with their quantity, location, opening date, and expiry date. The quantity is the amount recorded as opened, not an estimate of how much remains inside the package.

Select an item name to open its details in AL1S WMS. The browser displaying Home Assistant must also be able to reach AL1S.

## YAML dashboards

For a YAML-mode dashboard, add the card module under `resources`:

```yaml
resources:
  - url: /al1s_wms/al1s-inventory-card.js
    type: module
```

Then add the cards you need to a view. Inventory attention:

```yaml
type: custom:al1s-inventory-attention-card
```

In use:

```yaml
type: custom:al1s-opened-items-card
```

The card is read-only. Make stock changes in AL1S WMS.
