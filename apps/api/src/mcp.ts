import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export function createMcpServer(db: DatabaseSync) {
  const server = new McpServer({ name: "family-erp", version: "0.1.0" });

  server.registerTool("search_items", {
    title: "Search items",
    description: "Search active items in a Home by name or SKU.",
    inputSchema: {
      homeId: z.string().uuid(),
      query: z.string().min(1).max(100)
    }
  }, async ({ homeId, query }) => {
    const rows = db.prepare("SELECT id, sku, name, base_unit AS baseUnit, reorder_point AS reorderPoint, reorder_quantity AS reorderQuantity FROM items WHERE home_id = ? AND active = 1 AND (name LIKE ? OR sku LIKE ?) ORDER BY name LIMIT 50").all(homeId, `%${query}%`, `%${query}%`);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  });

  server.registerTool("get_stock", {
    title: "Get stock",
    description: "Return current stock balance for an item at a location.",
    inputSchema: {
      homeId: z.string().uuid(),
      itemId: z.string().uuid(),
      locationId: z.string().uuid()
    }
  }, async ({ homeId, itemId, locationId }) => {
    const row = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? AND location_id = ?").get(homeId, itemId, locationId);
    return { content: [{ type: "text", text: JSON.stringify({ homeId, itemId, locationId, ...row }) }] };
  });

  return server;
}

export async function handleMcpRequest(request: any, reply: any, db: DatabaseSync) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(db);
  await server.connect(transport);
  await transport.handleRequest(request.raw, reply.raw, request.body);
}
