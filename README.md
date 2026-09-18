# AL1S WMS

AL1S WMS is a self-hosted household warehouse management system for managing inventory, purchases, storage, stock batches, expiration dates, and physical stocktaking. Inspired by [Grocy](http://grocy.info/).

## Features

- Manage household items, categories, and hierarchical storage locations.
- Track quantities across locations with a complete stock movement history.
- Record each receipt as an independent batch with production and expiration dates.
- Consume stock by a selected batch or automatically using FEFO.
- Highlight expired, expiring, low-stock, and out-of-stock items.
- Maintain shopping lists with automatic replenishment suggestions.
- Receive purchased items directly into inventory.
- Reconcile physical counts and record gains or losses automatically.
- Track planned budgets, actual batch costs, channel price history, monthly spending, and inventory value.
- Look up products by barcode using household data, a local cache, and Open Facts databases.
- Give AI agents controlled access through MCP.

## Deployment

Build and run with Docker:

```bash
gh repo clone RicterZ/AL1S-WMS
cd AL1S-WMS
docker build -t al1s-wms .
docker run -d \
  --name al1s-wms \
  --restart unless-stopped \
  -p 8080:8080 \
  -v al1s-wms-data:/data \
  al1s-wms
```

Open `http://localhost:8080` and follow the initial setup.

The SQLite database is stored at `/data/al1s-wms.db`. Always persist `/data` with a Docker volume or bind mount.

Set `APIZERO_API_KEY` to use an authenticated ApiZero barcode lookup; without it, AL1S WMS uses the anonymous free quota.

To use a host directory:

```bash
docker run -d \
  --name al1s-wms \
  --restart unless-stopped \
  -p 8080:8080 \
  -v /root/docker-services/data/al1s-wms:/data \
  al1s-wms
```

## Internationalization

The web interface and user-facing API errors support Simplified Chinese
(`zh-CN`) and English (`en-US`). A saved choice in Settings takes precedence;
otherwise the browser language is used, with `zh-CN` as the fallback.

Web requests send the selected locale in `Accept-Language`. API clients can send
the same header explicitly. Response status codes, error `code` values, and
validation details do not vary by language.

Names and historical business data are not translated. This includes user data,
system category and location names, shopping channels, stock movement reasons,
and audit records.

For local verification, run:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## MCP

AL1S WMS exposes a Streamable HTTP MCP endpoint at:

```text
https://your-domain.example/mcp
```

Create a Bearer Token from **Settings → MCP Access Tokens**.

- A household-scoped token manages one household and does not require `homeId`.
- An account-scoped token can manage multiple households and requires the agent to select a `homeId`.

Example client configuration:

```json
{
  "mcpServers": {
    "al1s-wms": {
      "url": "https://your-domain.example/mcp",
      "headers": {
        "Authorization": "Bearer al1s_REPLACE_WITH_YOUR_TOKEN"
      }
    }
  }
}
```

Agents can use MCP to:

- Review household status, including replenishment needs, pending purchases, and expiring or expired batches.
- Search and manage items, categories, and storage locations.
- Resolve barcodes with `lookup_barcode` before creating or receiving items.
- Record receipts, issues, transfers, and physical stock counts.
- Create, update, delete, and receive shopping-list items.
- Inspect batches and update batch metadata.

Agents should start with `get_home_context`, then call `get_home_overview`. The `get_agent_guide` tool describes the supported receipt, purchasing, expiration-handling, and stocktaking workflows.

All inventory writes require an `idempotencyKey`. Reuse a key only when retrying the exact same operation.
