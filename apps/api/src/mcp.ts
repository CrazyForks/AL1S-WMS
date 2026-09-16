import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export function createMcpServer(db: DatabaseSync) {
  const server = new McpServer({ name: "family-erp", version: "0.1.0" });

  server.registerTool("search_items", {
    title: "Search items",
    description: "Search active items in a Home with optional location, low-stock, and expiry filters.",
    inputSchema: {
      homeId: z.string().uuid(),
      query: z.string().min(1).max(100).optional(),
      locationId: z.string().uuid().optional(),
      lowStockOnly: z.boolean().optional(),
      expiryBefore: z.string().date().optional()
    }
  }, async ({ homeId, query, locationId, lowStockOnly, expiryBefore }) => {
    const conditions = ["items.home_id = ?", "items.active = 1"];
    const params: (string | number)[] = [homeId];
    if (query) { conditions.push("(items.name LIKE ? OR items.sku LIKE ?)"); params.push(`%${query}%`, `%${query}%`); }
    if (locationId) { conditions.push("items.default_location_id = ?"); params.push(locationId); }
    if (lowStockOnly) conditions.push("(SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) FROM stock_transactions WHERE item_id = items.id) < items.reorder_point");
    if (expiryBefore) { conditions.push("items.expiry_date IS NOT NULL AND items.expiry_date <= ?"); params.push(expiryBefore); }
    const rows = db.prepare(`SELECT items.id, items.sku, items.name, items.base_unit AS baseUnit, items.reorder_point AS reorderPoint, items.manufactured_date AS manufacturedDate, items.expiry_date AS expiryDate, (SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) FROM stock_transactions WHERE item_id = items.id) AS quantity FROM items WHERE ${conditions.join(" AND ")} ORDER BY items.name LIMIT 50`).all(...params);
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

  server.registerTool("list_locations", {
    title: "List locations",
    description: "List active storage locations in a Home.",
    inputSchema: { homeId: z.string().uuid() }
  }, async ({ homeId }) => {
    const rows = db.prepare("SELECT id, name FROM locations WHERE home_id = ? AND active = 1 ORDER BY name").all(homeId);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  });

  server.registerTool("list_transactions", {
    title: "List transactions",
    description: "List recent inventory transactions in a Home.",
    inputSchema: { homeId: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }
  }, async ({ homeId, limit = 50 }) => {
    const rows = db.prepare("SELECT id, item_id AS itemId, location_id AS locationId, type, quantity, reason, occurred_at AS occurredAt FROM stock_transactions WHERE home_id = ? ORDER BY occurred_at DESC LIMIT ?").all(homeId, limit);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  });

  server.registerTool("record_receipt", {
    title: "Record receipt",
    description: "Record stock received into a location. Requires a unique idempotency key.",
    inputSchema: { homeId: z.string().uuid(), itemId: z.string().uuid(), locationId: z.string().uuid(), quantity: z.number().positive(), idempotencyKey: z.string().min(1), reason: z.string().max(200).optional() }
  }, async ({ homeId, itemId, locationId, quantity, idempotencyKey, reason }) => {
    const existing = db.prepare("SELECT id FROM stock_transactions WHERE home_id = ? AND idempotency_key = ?").get(homeId, idempotencyKey);
    if (existing) return { content: [{ type: "text", text: JSON.stringify(existing) }] };
    const id = randomUUID();
    db.prepare("INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'receipt', ?, ?, ?, ?)").run(id, homeId, itemId, locationId, quantity, reason ?? "MCP 入库", idempotencyKey, new Date().toISOString());
    return { content: [{ type: "text", text: JSON.stringify({ id, homeId, itemId, locationId, quantity, type: "receipt" }) }] };
  });

  server.registerTool("record_issue", {
    title: "Record issue",
    description: "Record stock issued from a location. Rejects negative balances.",
    inputSchema: { homeId: z.string().uuid(), itemId: z.string().uuid(), locationId: z.string().uuid(), quantity: z.number().positive(), idempotencyKey: z.string().min(1), reason: z.string().max(200).optional() }
  }, async ({ homeId, itemId, locationId, quantity, idempotencyKey, reason }) => {
    const existing = db.prepare("SELECT id FROM stock_transactions WHERE home_id = ? AND idempotency_key = ?").get(homeId, idempotencyKey);
    if (existing) return { content: [{ type: "text", text: JSON.stringify(existing) }] };
    const balance = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? AND location_id = ?").get(homeId, itemId, locationId) as { quantity: number };
    if (balance.quantity < quantity) return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "INSUFFICIENT_STOCK", available: balance.quantity }) }] };
    const id = randomUUID();
    db.prepare("INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'issue', ?, ?, ?, ?)").run(id, homeId, itemId, locationId, quantity, reason ?? "MCP 领用", idempotencyKey, new Date().toISOString());
    return { content: [{ type: "text", text: JSON.stringify({ id, homeId, itemId, locationId, quantity, type: "issue" }) }] };
  });

  return server;
}

export async function handleMcpRequest(request: any, reply: any, db: DatabaseSync) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(db);
  await server.connect(transport);
  await transport.handleRequest(request.raw, reply.raw, request.body);
}
