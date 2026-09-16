import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createItemSchema, updateItemSchema, type Item } from "@family-erp/contracts";
import { stockCommandSchema } from "@family-erp/contracts";
import { openDatabase } from "@family-erp/db";
import { handleMcpRequest } from "./mcp.js";

const app = Fastify({ logger: true });
const db = openDatabase();

function setSession(reply: any, userId: string) {
  const id = randomUUID();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, new Date(Date.now() + 30 * 86400000).toISOString());
  reply.header("set-cookie", `session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
}
function sessionUser(request: any) {
  const cookie = request.headers.cookie?.split(";").map((part: string) => part.trim()).find((part: string) => part.startsWith("session="));
  const id = cookie?.slice(8);
  if (!id) return undefined;
  return db.prepare("SELECT users.id, users.username, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ?").get(id, new Date().toISOString());
}

app.addHook("preHandler", async (request, reply) => {
  const publicPath = request.url === "/healthz" || request.url === "/api/v1/setup/status" || request.url === "/api/v1/setup" || request.url === "/api/v1/auth/login";
  if (!publicPath && !sessionUser(request)) return reply.code(401).send({ code: "UNAUTHENTICATED" });
});

app.get("/api/v1/auth/me", async (request, reply) => sessionUser(request) ?? reply.code(401).send({ code: "UNAUTHENTICATED" }));
app.post<{ Body: unknown }>("/api/v1/auth/login", async (request, reply) => {
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(username) as { id: string; password_hash: string } | undefined;
  if (!user) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "用户名或密码错误" });
  const [salt, expected] = user.password_hash.split(":");
  const actual = scryptSync(password, salt, 64).toString("hex");
  if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return reply.code(401).send({ code: "INVALID_CREDENTIALS", message: "用户名或密码错误" });
  setSession(reply, user.id);
  return { username };
});

app.get("/api/v1/setup/status", async () => {
  const setting = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  const home = db.prepare("SELECT id, name, icon FROM homes ORDER BY rowid LIMIT 1").get() as { id: string; name: string; icon: string } | undefined;
  return { complete: setting.count > 0, home };
});

app.post<{ Body: unknown }>("/api/v1/setup", async (request, reply) => {
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const homeName = typeof body.homeName === "string" ? body.homeName.trim() : "";
  const homeIcon = typeof body.homeIcon === "string" && body.homeIcon ? body.homeIcon : "🏠";
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
  const home = db.prepare("INSERT INTO homes (id, name, icon, timezone, default_currency) VALUES (?, ?, ?, ?, ?)");
  const location = db.prepare("INSERT INTO locations (id, home_id, name) VALUES (?, ?, ?)");
  db.exec("BEGIN");
  try {
    insert.run(userId, username, passwordHash, new Date().toISOString());
    home.run(homeId, homeName, homeIcon, timezone, currency);
    for (const name of [...new Set(locationNames)]) location.run(randomUUID(), homeId, name);
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('setup_complete', 'true')").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  setSession(reply, userId);
  return reply.code(201).send({ home: { id: homeId, name: homeName, icon: homeIcon }, username });
});

app.get("/healthz", async () => ({ status: "ok" }));

app.get<{ Params: { homeId: string } }>("/api/v1/homes/:homeId/items", async (request) => {
  return db.prepare("SELECT items.id, items.home_id AS homeId, items.sku, items.name, items.base_unit AS baseUnit, items.reorder_point AS reorderPoint, items.reorder_quantity AS reorderQuantity, items.manufactured_date AS manufacturedDate, items.expiry_date AS expiryDate, items.default_location_id AS locationId, locations.name AS locationName, items.active FROM items LEFT JOIN locations ON locations.id = items.default_location_id WHERE items.home_id = ? AND items.active = 1 ORDER BY items.name").all(request.params.homeId);
});

app.get<{ Params: { homeId: string; itemId: string } }>("/api/v1/homes/:homeId/items/:itemId", async (request, reply) => {
  const item = db.prepare("SELECT items.id, items.home_id AS homeId, items.sku, items.name, items.base_unit AS baseUnit, items.reorder_point AS reorderPoint, items.reorder_quantity AS reorderQuantity, items.manufactured_date AS manufacturedDate, items.expiry_date AS expiryDate, items.default_location_id AS locationId, locations.name AS locationName, items.active FROM items LEFT JOIN locations ON locations.id = items.default_location_id WHERE items.home_id = ? AND items.id = ? AND items.active = 1").get(request.params.homeId, request.params.itemId);
  return item ?? reply.code(404).send({ code: "ITEM_NOT_FOUND" });
});

app.patch<{ Params: { homeId: string; itemId: string }; Body: unknown }>("/api/v1/homes/:homeId/items/:itemId", async (request, reply) => {
  const parsed = updateItemSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", details: parsed.error.flatten() });
  if (!db.prepare("SELECT id FROM items WHERE id = ? AND home_id = ? AND active = 1").get(request.params.itemId, request.params.homeId)) return reply.code(404).send({ code: "ITEM_NOT_FOUND" });
  if (parsed.data.locationId && !db.prepare("SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1").get(parsed.data.locationId, request.params.homeId)) return reply.code(400).send({ code: "LOCATION_NOT_FOUND" });
  const fields = Object.keys(parsed.data).map((key) => ({ name: key === "baseUnit" ? "base_unit" : key === "reorderPoint" ? "reorder_point" : key === "locationId" ? "default_location_id" : key === "manufacturedDate" ? "manufactured_date" : key === "expiryDate" ? "expiry_date" : key, value: ((parsed.data as Record<string, unknown>)[key] ?? null) as string | number | null }));
  db.prepare(`UPDATE items SET ${fields.map((field) => `${field.name} = ?`).join(", ")} WHERE id = ? AND home_id = ?`).run(...fields.map((field) => field.value), request.params.itemId, request.params.homeId);
  return db.prepare("SELECT items.id, items.home_id AS homeId, items.sku, items.name, items.base_unit AS baseUnit, items.reorder_point AS reorderPoint, items.manufactured_date AS manufacturedDate, items.expiry_date AS expiryDate, items.default_location_id AS locationId, locations.name AS locationName, items.active FROM items LEFT JOIN locations ON locations.id = items.default_location_id WHERE items.id = ? AND items.home_id = ?").get(request.params.itemId, request.params.homeId);
});

app.get<{ Params: { homeId: string } }>("/api/v1/homes/:homeId/stock", async (request) => {
  return db.prepare("SELECT item_id AS itemId, location_id AS locationId, COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? GROUP BY item_id, location_id").all(request.params.homeId);
});

app.get<{ Params: { homeId: string } }>("/api/v1/homes/:homeId/locations", async (request) => {
  return db.prepare("SELECT id, home_id AS homeId, name, active FROM locations WHERE home_id = ? AND active = 1 ORDER BY name").all(request.params.homeId);
});

app.post<{ Params: { homeId: string }; Body: unknown }>("/api/v1/homes/:homeId/locations", async (request, reply) => {
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "地点名称不能为空" });
  const id = randomUUID();
  try { db.prepare("INSERT INTO locations (id, home_id, name) VALUES (?, ?, ?)").run(id, request.params.homeId, name); }
  catch (error) { if (String(error).includes("UNIQUE")) return reply.code(409).send({ code: "LOCATION_EXISTS" }); throw error; }
  return reply.code(201).send({ id, homeId: request.params.homeId, name, active: true });
});

app.get<{ Params: { homeId: string } }>("/api/v1/homes/:homeId/transactions", async (request) => {
  return db.prepare("SELECT stock_transactions.id, stock_transactions.item_id AS itemId, items.name AS itemName, stock_transactions.location_id AS locationId, locations.name AS locationName, stock_transactions.type, stock_transactions.quantity, stock_transactions.reason, stock_transactions.idempotency_key AS idempotencyKey, stock_transactions.occurred_at AS occurredAt FROM stock_transactions JOIN items ON items.id = stock_transactions.item_id JOIN locations ON locations.id = stock_transactions.location_id WHERE stock_transactions.home_id = ? ORDER BY stock_transactions.occurred_at DESC LIMIT 100").all(request.params.homeId);
});

app.post<{ Params: { homeId: string }; Body: unknown }>("/api/v1/homes/:homeId/stock/transfers", async (request, reply) => {
  const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const sourceLocationId = typeof body.sourceLocationId === "string" ? body.sourceLocationId : "";
  const targetLocationId = typeof body.targetLocationId === "string" ? body.targetLocationId : "";
  const quantity = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!itemId || !sourceLocationId || !targetLocationId || !Number.isFinite(quantity) || quantity <= 0 || !idempotencyKey) return reply.code(400).send({ code: "VALIDATION_ERROR" });
  const balance = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? AND location_id = ?").get(request.params.homeId, itemId, sourceLocationId) as { quantity: number };
  if (balance.quantity < quantity) return reply.code(409).send({ code: "INSUFFICIENT_STOCK", available: balance.quantity });
  const exists = db.prepare("SELECT id FROM stock_transactions WHERE home_id = ? AND idempotency_key = ?").get(request.params.homeId, idempotencyKey);
  if (exists) return exists;
  const outId = randomUUID(); const inId = randomUUID(); const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const insert = db.prepare("INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run(outId, request.params.homeId, itemId, sourceLocationId, "issue", quantity, "调拨出库", `${idempotencyKey}:out`, now);
    insert.run(inId, request.params.homeId, itemId, targetLocationId, "receipt", quantity, "调拨入库", `${idempotencyKey}:in`, now);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return reply.code(201).send({ idempotencyKey, outId, inId, itemId, sourceLocationId, targetLocationId, quantity });
});

app.post<{ Params: { homeId: string }; Body: unknown }>("/api/v1/homes/:homeId/items", async (request, reply) => {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const parsed = createItemSchema.safeParse({ ...body, homeId: request.params.homeId });
  if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", details: parsed.error.flatten() });

  if (!db.prepare("SELECT id FROM homes WHERE id = ?").get(request.params.homeId)) return reply.code(404).send({ code: "HOME_NOT_FOUND" });
  const id = randomUUID();
  const sku = parsed.data.sku || `ITEM-${id.slice(0, 8).toUpperCase()}`;
  const item: Item = { ...parsed.data, id, sku, active: true };
  const locationId = parsed.data.locationId ?? null;
  if (parsed.data.initialStock > 0 && !locationId) return reply.code(400).send({ code: "LOCATION_REQUIRED", message: "有初始库存时必须指定地点" });
  if (locationId && !db.prepare("SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1").get(locationId, request.params.homeId)) return reply.code(400).send({ code: "LOCATION_NOT_FOUND" });
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO items (id, home_id, sku, name, base_unit, reorder_point, reorder_quantity, default_location_id, manufactured_date, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(item.id, item.homeId, sku, item.name, item.baseUnit, item.reorderPoint, item.reorderQuantity, locationId, parsed.data.manufacturedDate ?? null, parsed.data.expiryDate ?? null);
    if (parsed.data.initialStock > 0) db.prepare("INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'receipt', ?, ?, ?, ?)").run(randomUUID(), item.homeId, item.id, locationId, parsed.data.initialStock, "初始库存", `initial:${item.id}`, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return reply.code(201).send({ ...item, sku, locationId });
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
