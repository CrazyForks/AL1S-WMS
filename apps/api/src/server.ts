import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { randomBytes, scryptSync } from "node:crypto";
import { createItemSchema, type Item } from "@family-erp/contracts";
import { stockCommandSchema } from "@family-erp/contracts";
import { openDatabase } from "@family-erp/db";
import { handleMcpRequest } from "./mcp.js";

const app = Fastify({ logger: true });
const db = openDatabase();

app.get("/api/v1/setup/status", async () => {
  const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'").get() as { value: string } | undefined;
  const home = db.prepare("SELECT id, name FROM homes ORDER BY rowid LIMIT 1").get() as { id: string; name: string } | undefined;
  return { complete: setting?.value === "true", home };
});

app.post<{ Body: unknown }>("/api/v1/setup", async (request, reply) => {
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const homeName = typeof body.homeName === "string" ? body.homeName.trim() : "";
  const timezone = typeof body.timezone === "string" && body.timezone ? body.timezone : "Asia/Shanghai";
  const currency = typeof body.currency === "string" && body.currency ? body.currency : "CNY";
  const locationNames = Array.isArray(body.locations) ? body.locations.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean) : [];
  if (username.length < 2 || password.length < 8 || !homeName || locationNames.length === 0) return reply.code(400).send({ code: "SETUP_INVALID", message: "账号、密码、家庭名称和至少一个地点不能为空" });
  const complete = db.prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'").get() as { value: string } | undefined;
  if (complete?.value === "true") return reply.code(409).send({ code: "SETUP_COMPLETE" });
  const homeId = randomUUID();
  const userId = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const insert = db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)");
  const home = db.prepare("INSERT INTO homes (id, name, timezone, default_currency) VALUES (?, ?, ?, ?)");
  const location = db.prepare("INSERT INTO locations (id, home_id, name) VALUES (?, ?, ?)");
  db.exec("BEGIN");
  try {
    insert.run(userId, username, passwordHash, new Date().toISOString());
    home.run(homeId, homeName, timezone, currency);
    for (const name of [...new Set(locationNames)]) location.run(randomUUID(), homeId, name);
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('setup_complete', 'true')").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return reply.code(201).send({ home: { id: homeId, name: homeName }, username });
});

app.get("/healthz", async () => ({ status: "ok" }));

app.get<{ Params: { homeId: string } }>("/api/v1/homes/:homeId/items", async (request) => {
  return db.prepare("SELECT id, home_id AS homeId, sku, name, base_unit AS baseUnit, reorder_point AS reorderPoint, reorder_quantity AS reorderQuantity, active FROM items WHERE home_id = ? AND active = 1 ORDER BY name").all(request.params.homeId);
});

app.get<{ Params: { homeId: string } }>("/api/v1/homes/:homeId/stock", async (request) => {
  return db.prepare("SELECT item_id AS itemId, location_id AS locationId, COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? GROUP BY item_id, location_id").all(request.params.homeId);
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

app.all("/mcp", async (request, reply) => handleMcpRequest(request, reply, db));

const port = Number(process.env.PORT ?? 8080);
app.listen({ host: process.env.BIND_ADDRESS ?? "0.0.0.0", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
