import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { createItemSchema, type Item } from "@family-erp/contracts";
import { stockCommandSchema } from "@family-erp/contracts";
import { openDatabase } from "@family-erp/db";

const app = Fastify({ logger: true });
const db = openDatabase();

app.get("/healthz", async () => ({ status: "ok" }));

app.get<{ Params: { homeId: string } }>("/api/v1/homes/:homeId/items", async (request) => {
  return db.prepare("SELECT id, home_id AS homeId, sku, name, base_unit AS baseUnit, reorder_point AS reorderPoint, reorder_quantity AS reorderQuantity, active FROM items WHERE home_id = ? AND active = 1 ORDER BY name").all(request.params.homeId);
});

app.post<{ Params: { homeId: string }; Body: unknown }>("/api/v1/homes/:homeId/items", async (request, reply) => {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const parsed = createItemSchema.safeParse({ ...body, homeId: request.params.homeId });
  if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", details: parsed.error.flatten() });

  db.prepare("INSERT OR IGNORE INTO homes (id, name) VALUES (?, ?)").run(request.params.homeId, "Home");
  const item: Item = { ...parsed.data, id: randomUUID(), active: true };
  db.prepare("INSERT INTO items (id, home_id, sku, name, base_unit, reorder_point, reorder_quantity) VALUES (?, ?, ?, ?, ?, ?, ?)").run(item.id, item.homeId, item.sku, item.name, item.baseUnit, item.reorderPoint, item.reorderQuantity);
  return reply.code(201).send(item);
});

app.post<{ Params: { homeId: string; type: "receipt" | "issue" }; Body: unknown }>("/api/v1/homes/:homeId/stock/:type", async (request, reply) => {
  if (request.params.type !== "receipt" && request.params.type !== "issue") return reply.code(404).send({ code: "NOT_FOUND" });
  const parsed = stockCommandSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", details: parsed.error.flatten() });
  const item = db.prepare("SELECT id FROM items WHERE id = ? AND home_id = ? AND active = 1").get(parsed.data.itemId, request.params.homeId);
  if (!item) return reply.code(404).send({ code: "ITEM_NOT_FOUND" });
  if (request.params.type === "issue") {
    const balance = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? AND location_id = ?").get(request.params.homeId, parsed.data.itemId, parsed.data.locationId) as { quantity: number };
    if (balance.quantity < parsed.data.quantity) return reply.code(409).send({ code: "INSUFFICIENT_STOCK", available: balance.quantity });
  }
  const id = randomUUID();
  try {
    db.prepare("INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, request.params.homeId, parsed.data.itemId, parsed.data.locationId, request.params.type, parsed.data.quantity, parsed.data.reason ?? null, parsed.data.idempotencyKey, new Date().toISOString());
  } catch (error) {
    if (String(error).includes("UNIQUE")) return db.prepare("SELECT * FROM stock_transactions WHERE home_id = ? AND idempotency_key = ?").get(request.params.homeId, parsed.data.idempotencyKey);
    throw error;
  }
  return reply.code(201).send({ id, ...parsed.data, homeId: request.params.homeId, type: request.params.type });
});

app.register(async (mcp) => {
  mcp.post("/mcp", async () => ({
    jsonrpc: "2.0",
    error: { code: -32601, message: "MCP transport is reserved for the Streamable HTTP adapter" },
    id: null
  }));
});

const port = Number(process.env.PORT ?? 8080);
app.listen({ host: process.env.BIND_ADDRESS ?? "127.0.0.1", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
