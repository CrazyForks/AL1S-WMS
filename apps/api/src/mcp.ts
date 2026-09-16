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

  server.registerTool("get_item", {
    title: "Get item",
    description: "Get one item with its replenishment and expiry fields.",
    inputSchema: { homeId: z.string().uuid(), itemId: z.string().uuid() }
  }, async ({ homeId, itemId }) => {
    const row = db.prepare("SELECT id, sku, name, base_unit AS baseUnit, reorder_point AS reorderPoint, manufactured_date AS manufacturedDate, expiry_date AS expiryDate, default_location_id AS locationId FROM items WHERE home_id = ? AND id = ? AND active = 1").get(homeId, itemId);
    return { content: [{ type: "text", text: JSON.stringify(row ?? { code: "ITEM_NOT_FOUND" }) }] };
  });

  server.registerTool("update_item", {
    title: "Update item",
    description: "Update editable item fields. System SKU cannot be changed.",
    inputSchema: { homeId: z.string().uuid(), itemId: z.string().uuid(), name: z.string().min(1).optional(), baseUnit: z.string().min(1).optional(), reorderPoint: z.number().nonnegative().optional(), locationId: z.string().uuid().nullable().optional(), manufacturedDate: z.string().date().nullable().optional(), expiryDate: z.string().date().nullable().optional() }
  }, async ({ homeId, itemId, ...changes }) => {
    const fields = Object.entries(changes).filter(([, value]) => value !== undefined).map(([key, value]) => ({ name: key === "baseUnit" ? "base_unit" : key === "reorderPoint" ? "reorder_point" : key === "locationId" ? "default_location_id" : key === "manufacturedDate" ? "manufactured_date" : key === "expiryDate" ? "expiry_date" : key, value: value ?? null }));
    if (!fields.length) return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "NO_CHANGES" }) }] };
    if (!db.prepare("SELECT id FROM items WHERE home_id = ? AND id = ? AND active = 1").get(homeId, itemId)) return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "ITEM_NOT_FOUND" }) }] };
    db.prepare(`UPDATE items SET ${fields.map((field) => `${field.name} = ?`).join(", ")} WHERE home_id = ? AND id = ?`).run(...fields.map((field) => field.value), homeId, itemId);
    return { content: [{ type: "text", text: JSON.stringify({ id: itemId, updated: fields.map((field) => field.name) }) }] };
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
    const rows = db.prepare("SELECT stock_transactions.id, stock_transactions.item_id AS itemId, items.name AS itemName, stock_transactions.location_id AS locationId, locations.name AS locationName, stock_transactions.type, stock_transactions.quantity, stock_transactions.reason, stock_transactions.occurred_at AS occurredAt FROM stock_transactions JOIN items ON items.id = stock_transactions.item_id JOIN locations ON locations.id = stock_transactions.location_id WHERE stock_transactions.home_id = ? ORDER BY stock_transactions.occurred_at DESC LIMIT ?").all(homeId, limit);
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
