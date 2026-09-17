import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createItemSchema,
  updateItemSchema,
  type Item,
} from "@family-erp/contracts";
import { stockCommandSchema } from "@family-erp/contracts";
import { openDatabase } from "@family-erp/db";
import { handleMcpRequest } from "./mcp.js";
import { deleteInventoryEntity, DeleteError, transactionQuery } from "./inventory-delete.js";

const app = Fastify({ logger: true });
const db = openDatabase();
const defaultCategories = [
  "食品",
  "饮品",
  "日用品",
  "药品与健康",
  "衣物",
  "工具",
  "电器",
  "文具",
  "宠物用品",
  "其他",
];
for (const home of db.prepare("SELECT id FROM homes").all() as { id: string }[])
  for (const name of defaultCategories)
    db.prepare(
      "INSERT OR IGNORE INTO item_categories (id, home_id, name, is_system) VALUES (?, ?, ?, 1)",
    ).run(randomUUID(), home.id, name);

function setSession(reply: any, userId: string) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(id, userId, new Date(Date.now() + 30 * 86400000).toISOString());
  reply.header(
    "set-cookie",
    `session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
  );
}
function sessionUser(request: any) {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part: string) => part.trim())
    .find((part: string) => part.startsWith("session="));
  const id = cookie?.slice(8);
  if (!id) return undefined;
  return db
    .prepare(
      "SELECT users.id, users.username, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ?",
    )
    .get(id, new Date().toISOString());
}
function tokenUser(request: any) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer "))
    return undefined;
  const token = authorization.slice(7).trim();
  if (!token.startsWith("al1s_") || token.length < 30) return undefined;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db
    .prepare(
      "SELECT api_tokens.id, users.id AS userId, users.username, users.role FROM api_tokens JOIN users ON users.id = api_tokens.user_id WHERE api_tokens.token_hash = ? AND api_tokens.revoked_at IS NULL",
    )
    .get(tokenHash) as
    | { id: string; userId: string; username: string; role: string }
    | undefined;
  if (row)
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      row.id,
    );
  return row;
}
function wouldCreateCycle(
  table: "locations" | "item_categories",
  id: string,
  parentId: string | null,
  homeId: string,
) {
  let current = parentId;
  while (current) {
    if (current === id) return true;
    const row = db
      .prepare(
        `SELECT parent_id AS parentId FROM ${table} WHERE id = ? AND home_id = ? AND active = 1`,
      )
      .get(current, homeId) as { parentId: string | null } | undefined;
    current = row?.parentId ?? null;
  }
  return false;
}

app.addHook("preHandler", async (request, reply) => {
  if (request.url.split("?")[0] === "/mcp") {
    if (!tokenUser(request))
      return reply
        .code(401)
        .header("www-authenticate", "Bearer")
        .send({ code: "INVALID_API_TOKEN" });
    return;
  }
  const publicPath =
    (!request.url.startsWith("/api/") &&
      !request.url.startsWith("/mcp")) ||
    request.url === "/healthz" ||
    request.url === "/api/v1/setup/status" ||
    request.url === "/api/v1/setup" ||
    request.url === "/api/v1/auth/login";
  if (!publicPath && !sessionUser(request))
    return reply.code(401).send({ code: "UNAUTHENTICATED" });
});

app.get("/api/v1/auth/tokens", async (request) => {
  const user = sessionUser(request) as { id: string };
  return db
    .prepare(
      "SELECT id, name, token_prefix AS tokenPrefix, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(user.id);
});

app.post<{ Body: unknown }>("/api/v1/auth/tokens", async (request, reply) => {
  const user = sessionUser(request) as { id: string };
  const body =
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80)
    return reply.code(400).send({ code: "INVALID_TOKEN_NAME" });
  const token = `al1s_${randomBytes(32).toString("hex")}`;
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const tokenPrefix = `${token.slice(0, 13)}…`;
  db.prepare(
    "INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    user.id,
    name,
    createHash("sha256").update(token).digest("hex"),
    tokenPrefix,
    createdAt,
  );
  return reply.code(201).send({ id, name, token, tokenPrefix, createdAt });
});

app.delete<{ Params: { tokenId: string } }>(
  "/api/v1/auth/tokens/:tokenId",
  async (request, reply) => {
    const user = sessionUser(request) as { id: string };
    const result = db
      .prepare(
        "UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
      )
      .run(new Date().toISOString(), request.params.tokenId, user.id);
    return result.changes
      ? { id: request.params.tokenId, revoked: true }
      : reply.code(404).send({ code: "TOKEN_NOT_FOUND" });
  },
);

app.get(
  "/api/v1/auth/me",
  async (request, reply) =>
    sessionUser(request) ?? reply.code(401).send({ code: "UNAUTHENTICATED" }),
);
app.post<{ Body: unknown }>("/api/v1/auth/login", async (request, reply) => {
  const body =
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : {};
  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE username = ?")
    .get(username) as { id: string; password_hash: string } | undefined;
  if (!user)
    return reply
      .code(401)
      .send({ code: "INVALID_CREDENTIALS", message: "用户名或密码错误" });
  const [salt, expected] = user.password_hash.split(":");
  const actual = scryptSync(password, salt, 64).toString("hex");
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  )
    return reply
      .code(401)
      .send({ code: "INVALID_CREDENTIALS", message: "用户名或密码错误" });
  setSession(reply, user.id);
  return { username };
});

app.get("/api/v1/setup/status", async () => {
  const setting = db.prepare("SELECT COUNT(*) AS count FROM users").get() as {
    count: number;
  };
  const home = db
    .prepare("SELECT id, name, icon FROM homes ORDER BY rowid LIMIT 1")
    .get() as { id: string; name: string; icon: string } | undefined;
  return { complete: setting.count > 0, home };
});

app.post<{ Body: unknown }>("/api/v1/setup", async (request, reply) => {
  const body =
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : {};
  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const homeName =
    typeof body.homeName === "string" ? body.homeName.trim() : "";
  const homeIcon =
    typeof body.homeIcon === "string" && body.homeIcon ? body.homeIcon : "🏠";
  const timezone =
    typeof body.timezone === "string" && body.timezone
      ? body.timezone
      : "Asia/Shanghai";
  const currency =
    typeof body.currency === "string" && body.currency ? body.currency : "CNY";
  const locationNames = Array.isArray(body.locations)
    ? body.locations
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  if (
    username.length < 2 ||
    password.length < 8 ||
    !homeName ||
    locationNames.length === 0
  )
    return reply.code(400).send({
      code: "SETUP_INVALID",
      message: "账号、密码、家庭名称和至少一个地点不能为空",
    });
  const complete = db
    .prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'")
    .get() as { value: string } | undefined;
  if (complete?.value === "true")
    return reply.code(409).send({ code: "SETUP_COMPLETE" });
  const homeId = randomUUID();
  const userId = randomUUID();
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const insert = db.prepare(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
  );
  const home = db.prepare(
    "INSERT INTO homes (id, name, icon, timezone, default_currency) VALUES (?, ?, ?, ?, ?)",
  );
  const location = db.prepare(
    "INSERT INTO locations (id, home_id, name) VALUES (?, ?, ?)",
  );
  db.exec("BEGIN");
  try {
    insert.run(userId, username, passwordHash, new Date().toISOString());
    home.run(homeId, homeName, homeIcon, timezone, currency);
    for (const name of defaultCategories)
      db.prepare(
        "INSERT INTO item_categories (id, home_id, name, is_system) VALUES (?, ?, ?, 1)",
      ).run(randomUUID(), homeId, name);
    for (const name of [...new Set(locationNames)])
      location.run(randomUUID(), homeId, name);
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('setup_complete', 'true')",
    ).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  setSession(reply, userId);
  return reply
    .code(201)
    .send({ home: { id: homeId, name: homeName, icon: homeIcon }, username });
});

app.get("/healthz", async () => ({ status: "ok" }));

app.get("/api/v1/homes", async () =>
  db.prepare("SELECT id, name, icon FROM homes WHERE active = 1 ORDER BY rowid").all(),
);
app.post<{ Body: unknown }>("/api/v1/homes", async (request, reply) => {
  const body = request.body as { name?: unknown; icon?: unknown } | null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80 || typeof body.icon !== "string" || !["house", "building", "trees", "warehouse", "castle", "leaf", "star", "🏠", "🏡", "🏢", "🏘️", "🌿", "⭐"].includes(body.icon))
    return reply.code(400).send({ message: "请填写家庭名称并选择图标" });
  const home = { id: randomUUID(), name: body.name.trim(), icon: body.icon };
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO homes (id, name, icon, timezone, default_currency) VALUES (?, ?, ?, 'Asia/Shanghai', 'CNY')").run(home.id, home.name, home.icon);
    for (const name of defaultCategories)
      db.prepare("INSERT INTO item_categories (id, home_id, name, is_system) VALUES (?, ?, ?, 1)").run(randomUUID(), home.id, name);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return reply.code(201).send(home);
});
app.patch<{ Params: { homeId: string }; Body: unknown }>("/api/v1/homes/:homeId", async (request, reply) => {
  const body = request.body as { name?: unknown; icon?: unknown } | null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80 || typeof body.icon !== "string" || !["house", "building", "trees", "warehouse", "castle", "leaf", "star", "🏠", "🏡", "🏢", "🏘️", "🌿", "⭐"].includes(body.icon))
    return reply.code(400).send({ message: "请填写家庭名称并选择图标" });
  const result = db.prepare("UPDATE homes SET name = ?, icon = ? WHERE id = ? AND active = 1").run(body.name.trim(), body.icon, request.params.homeId);
  if (!result.changes) return reply.code(404).send({ message: "家庭不存在" });
  return { id: request.params.homeId, name: body.name.trim(), icon: body.icon };
});
app.post("/api/v1/auth/logout", async (request, reply) => {
  const session = request.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("session="))?.slice(8);
  if (session) db.prepare("DELETE FROM sessions WHERE id = ?").run(session);
  reply.header("set-cookie", "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  return { ok: true };
});

app.get<{ Params: { homeId: string } }>(
  "/api/v1/homes/:homeId/items",
  async (request) => {
    return db
      .prepare(
        "SELECT items.icon, items.id, items.home_id AS homeId, items.sku, items.name, items.category, items.base_unit AS baseUnit, items.reorder_point AS reorderPoint, items.reorder_quantity AS reorderQuantity, items.manufactured_date AS manufacturedDate, items.expiry_date AS expiryDate, items.default_location_id AS locationId, locations.name AS locationName, items.active FROM items LEFT JOIN locations ON locations.id = items.default_location_id WHERE items.home_id = ? AND items.active = 1 ORDER BY items.name",
      )
      .all(request.params.homeId);
  },
);

app.get<{ Params: { homeId: string; itemId: string } }>(
  "/api/v1/homes/:homeId/items/:itemId",
  async (request, reply) => {
    const item = db
      .prepare(
        "SELECT items.icon, items.id, items.home_id AS homeId, items.sku, items.name, items.category, items.base_unit AS baseUnit, items.reorder_point AS reorderPoint, items.reorder_quantity AS reorderQuantity, items.manufactured_date AS manufacturedDate, items.expiry_date AS expiryDate, items.default_location_id AS locationId, locations.name AS locationName, items.active FROM items LEFT JOIN locations ON locations.id = items.default_location_id WHERE items.home_id = ? AND items.id = ? AND items.active = 1",
      )
      .get(request.params.homeId, request.params.itemId);
    return item ?? reply.code(404).send({ code: "ITEM_NOT_FOUND" });
  },
);

app.patch<{ Params: { homeId: string; itemId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/items/:itemId",
  async (request, reply) => {
    const parsed = updateItemSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", details: parsed.error.flatten() });
    if (
      !db
        .prepare(
          "SELECT id FROM items WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(request.params.itemId, request.params.homeId)
    )
      return reply.code(404).send({ code: "ITEM_NOT_FOUND" });
    if (
      parsed.data.locationId &&
      !db
        .prepare(
          "SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(parsed.data.locationId, request.params.homeId)
    )
      return reply.code(400).send({ code: "LOCATION_NOT_FOUND" });
    const current = db
      .prepare(
        "SELECT default_location_id AS locationId FROM items WHERE id = ? AND home_id = ?",
      )
      .get(request.params.itemId, request.params.homeId) as {
      locationId: string | null;
    };
    const fields = Object.keys(parsed.data).map((key) => ({
      name:
        key === "baseUnit"
          ? "base_unit"
          : key === "reorderPoint"
            ? "reorder_point"
            : key === "locationId"
              ? "default_location_id"
              : key === "manufacturedDate"
                ? "manufactured_date"
                : key === "expiryDate"
                  ? "expiry_date"
                  : key,
      value: ((parsed.data as Record<string, unknown>)[key] ?? null) as
        | string
        | number
        | null,
    }));
    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE items SET ${fields.map((field) => `${field.name} = ?`).join(", ")} WHERE id = ? AND home_id = ?`,
      ).run(
        ...fields.map((field) => field.value),
        request.params.itemId,
        request.params.homeId,
      );
      const nextLocation =
        parsed.data.locationId === undefined
          ? current.locationId
          : parsed.data.locationId;
      if (
        parsed.data.locationId !== undefined &&
        nextLocation &&
        nextLocation !== current.locationId
      ) {
        const balances = db
          .prepare(
            "SELECT location_id AS locationId, COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? GROUP BY location_id HAVING quantity > 0",
          )
          .all(request.params.homeId, request.params.itemId) as {
          locationId: string;
          quantity: number;
        }[];
        const insert = db.prepare(
          "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        const now = new Date().toISOString();
        for (const balance of balances)
          if (balance.locationId !== nextLocation) {
            const key = `relocate:${request.params.itemId}:${randomUUID()}`;
            insert.run(
              randomUUID(),
              request.params.homeId,
              request.params.itemId,
              balance.locationId,
              "issue",
              balance.quantity,
              "更改存放地点",
              `${key}:out`,
              now,
            );
            insert.run(
              randomUUID(),
              request.params.homeId,
              request.params.itemId,
              nextLocation,
              "receipt",
              balance.quantity,
              "更改存放地点",
              `${key}:in`,
              now,
            );
          }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return db
      .prepare(
        "SELECT items.icon, items.id, items.home_id AS homeId, items.sku, items.name, items.category, items.base_unit AS baseUnit, items.reorder_point AS reorderPoint, items.manufactured_date AS manufacturedDate, items.expiry_date AS expiryDate, items.default_location_id AS locationId, locations.name AS locationName, items.active FROM items LEFT JOIN locations ON locations.id = items.default_location_id WHERE items.id = ? AND items.home_id = ?",
      )
      .get(request.params.itemId, request.params.homeId);
  },
);

app.get<{ Params: { homeId: string } }>(
  "/api/v1/homes/:homeId/stock",
  async (request) => {
    return db
      .prepare(
        "SELECT item_id AS itemId, location_id AS locationId, COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? GROUP BY item_id, location_id",
      )
      .all(request.params.homeId);
  },
);

app.get<{ Params: { homeId: string } }>(
  "/api/v1/homes/:homeId/locations",
  async (request) => {
    return db
      .prepare(
        "SELECT id, home_id AS homeId, parent_id AS parentId, name, active FROM locations WHERE home_id = ? AND active = 1 ORDER BY parent_id, name",
      )
      .all(request.params.homeId);
  },
);

app.get<{ Params: { homeId: string } }>(
  "/api/v1/homes/:homeId/categories",
  async (request) =>
    db
      .prepare(
        "SELECT id, parent_id AS parentId, name, is_system AS isSystem, active FROM item_categories WHERE home_id = ? AND active = 1 ORDER BY parent_id, name",
      )
      .all(request.params.homeId),
);
app.post<{ Params: { homeId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/categories",
  async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    let name = typeof body.name === "string" ? body.name.trim() : "";
    const parentId = typeof body.parentId === "string" ? body.parentId : null;
    if (!name)
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: "分类名称不能为空" });
    if (
      parentId &&
      !db
        .prepare(
          "SELECT id FROM item_categories WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(parentId, request.params.homeId)
    )
      return reply.code(400).send({ code: "PARENT_CATEGORY_NOT_FOUND" });
    const id = randomUUID();
    try {
      db.prepare(
        "INSERT INTO item_categories (id, home_id, parent_id, name) VALUES (?, ?, ?, ?)",
      ).run(id, request.params.homeId, parentId, name);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        return reply.code(409).send({ code: "CATEGORY_EXISTS" });
      throw error;
    }
    return reply
      .code(201)
      .send({ id, parentId, name, isSystem: false, active: true });
  },
);

app.patch<{ Params: { homeId: string; categoryId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/categories/:categoryId",
  async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const parentId =
      body.parentId === null || body.parentId === ""
        ? null
        : typeof body.parentId === "string"
          ? body.parentId
          : undefined;
    if (!name || parentId === undefined)
      return reply.code(400).send({ code: "VALIDATION_ERROR" });
    if (
      !db
        .prepare(
          "SELECT id FROM item_categories WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(request.params.categoryId, request.params.homeId)
    )
      return reply.code(404).send({ code: "CATEGORY_NOT_FOUND" });
    const current = db
      .prepare("SELECT name FROM item_categories WHERE id = ? AND home_id = ?")
      .get(request.params.categoryId, request.params.homeId) as {
      name: string;
    };
    if (
      parentId &&
      !db
        .prepare(
          "SELECT id FROM item_categories WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(parentId, request.params.homeId)
    )
      return reply.code(400).send({ code: "PARENT_CATEGORY_NOT_FOUND" });
    if (
      wouldCreateCycle(
        "item_categories",
        request.params.categoryId,
        parentId,
        request.params.homeId,
      )
    )
      return reply.code(400).send({ code: "CATEGORY_CYCLE" });
    try {
      db.exec("BEGIN");
      db.prepare(
        "UPDATE item_categories SET name = ?, parent_id = ? WHERE id = ? AND home_id = ?",
      ).run(name, parentId, request.params.categoryId, request.params.homeId);
      if (current.name !== name)
        db.prepare(
          "UPDATE items SET category = ? WHERE home_id = ? AND category = ?",
        ).run(name, request.params.homeId, current.name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error).includes("UNIQUE"))
        return reply.code(409).send({ code: "CATEGORY_EXISTS" });
      throw error;
    }
    return { id: request.params.categoryId, parentId, name };
  },
);

app.post<{ Params: { homeId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/locations",
  async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const parentId = typeof body.parentId === "string" ? body.parentId : null;
    if (!name)
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: "地点名称不能为空" });
    if (
      parentId &&
      !db
        .prepare(
          "SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(parentId, request.params.homeId)
    )
      return reply.code(400).send({ code: "PARENT_LOCATION_NOT_FOUND" });
    const id = randomUUID();
    try {
      db.prepare(
        "INSERT INTO locations (id, home_id, parent_id, name) VALUES (?, ?, ?, ?)",
      ).run(id, request.params.homeId, parentId, name);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        return reply.code(409).send({ code: "LOCATION_EXISTS" });
      throw error;
    }
    return reply.code(201).send({
      id,
      homeId: request.params.homeId,
      parentId,
      name,
      active: true,
    });
  },
);
app.patch<{ Params: { homeId: string; locationId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/locations/:locationId",
  async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const parentId =
      body.parentId === null || body.parentId === ""
        ? null
        : typeof body.parentId === "string"
          ? body.parentId
          : undefined;
    if (!name || parentId === undefined)
      return reply.code(400).send({ code: "VALIDATION_ERROR" });
    if (
      !db
        .prepare(
          "SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(request.params.locationId, request.params.homeId)
    )
      return reply.code(404).send({ code: "LOCATION_NOT_FOUND" });
    if (
      parentId &&
      !db
        .prepare(
          "SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(parentId, request.params.homeId)
    )
      return reply.code(400).send({ code: "PARENT_LOCATION_NOT_FOUND" });
    if (
      wouldCreateCycle(
        "locations",
        request.params.locationId,
        parentId,
        request.params.homeId,
      )
    )
      return reply.code(400).send({ code: "LOCATION_CYCLE" });
    try {
      db.prepare(
        "UPDATE locations SET name = ?, parent_id = ? WHERE id = ? AND home_id = ?",
      ).run(name, parentId, request.params.locationId, request.params.homeId);
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        return reply.code(409).send({ code: "LOCATION_EXISTS" });
      throw error;
    }
    return { id: request.params.locationId, parentId, name };
  },
);

for (const [resource, kind] of [["items", "item"], ["categories", "category"], ["locations", "location"]] as const) {
  app.delete<{ Params: { homeId: string; id: string } }>(`/api/v1/homes/:homeId/${resource}/:id`, async (request, reply) => {
    try { return deleteInventoryEntity(db, request.params.homeId, kind, request.params.id); }
    catch (error) {
      if (error instanceof DeleteError) return reply.code(error.status).send({ message: error.message });
      throw error;
    }
  });
}

app.get<{ Params: { homeId: string } }>(
  "/api/v1/homes/:homeId/transactions",
  async (request) => {
    return db
      .prepare(
        `SELECT * FROM (${transactionQuery}) WHERE homeId = ? ORDER BY occurredAt DESC, id DESC LIMIT 100`,
      )
      .all(request.params.homeId);
  },
);

app.post<{ Params: { homeId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/stock/transfers",
  async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    const sourceLocationId =
      typeof body.sourceLocationId === "string" ? body.sourceLocationId : "";
    const targetLocationId =
      typeof body.targetLocationId === "string" ? body.targetLocationId : "";
    const quantity =
      typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
    const idempotencyKey =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    if (
      !itemId ||
      !sourceLocationId ||
      !targetLocationId ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !idempotencyKey
    )
      return reply.code(400).send({ code: "VALIDATION_ERROR" });
    const balance = db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? AND location_id = ?",
      )
      .get(request.params.homeId, itemId, sourceLocationId) as {
      quantity: number;
    };
    if (balance.quantity < quantity)
      return reply
        .code(409)
        .send({ code: "INSUFFICIENT_STOCK", available: balance.quantity });
    const exists = db
      .prepare(
        "SELECT id FROM stock_transactions WHERE home_id = ? AND idempotency_key = ?",
      )
      .get(request.params.homeId, idempotencyKey);
    if (exists) return exists;
    const outId = randomUUID();
    const inId = randomUUID();
    const now = new Date().toISOString();
    db.exec("BEGIN");
    try {
      const insert = db.prepare(
        "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      insert.run(
        outId,
        request.params.homeId,
        itemId,
        sourceLocationId,
        "issue",
        quantity,
        "调拨出库",
        `${idempotencyKey}:out`,
        now,
      );
      insert.run(
        inId,
        request.params.homeId,
        itemId,
        targetLocationId,
        "receipt",
        quantity,
        "调拨入库",
        `${idempotencyKey}:in`,
        now,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return reply.code(201).send({
      idempotencyKey,
      outId,
      inId,
      itemId,
      sourceLocationId,
      targetLocationId,
      quantity,
    });
  },
);

app.post<{ Params: { homeId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/items",
  async (request, reply) => {
    const body =
      request.body && typeof request.body === "object" ? request.body : {};
    const parsed = createItemSchema.safeParse({
      ...body,
      homeId: request.params.homeId,
    });
    if (!parsed.success)
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", details: parsed.error.flatten() });

    if (
      !db
        .prepare("SELECT id FROM homes WHERE id = ?")
        .get(request.params.homeId)
    )
      return reply.code(404).send({ code: "HOME_NOT_FOUND" });
    const id = randomUUID();
    const sku = parsed.data.sku || `ITEM-${id.slice(0, 8).toUpperCase()}`;
    const item: Item = { ...parsed.data, id, sku, active: true };
    const locationId = parsed.data.locationId ?? null;
    if (parsed.data.initialStock > 0 && !locationId)
      return reply.code(400).send({
        code: "LOCATION_REQUIRED",
        message: "有初始库存时必须指定地点",
      });
    if (
      locationId &&
      !db
        .prepare(
          "SELECT id FROM locations WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(locationId, request.params.homeId)
    )
      return reply.code(400).send({ code: "LOCATION_NOT_FOUND" });
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO items (id, home_id, sku, name, category, base_unit, reorder_point, reorder_quantity, default_location_id, manufactured_date, expiry_date, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        item.id,
        item.homeId,
        sku,
        item.name,
        item.category,
        item.baseUnit,
        item.reorderPoint,
        item.reorderQuantity,
        locationId,
        parsed.data.manufacturedDate ?? null,
        parsed.data.expiryDate ?? null,
        parsed.data.icon ?? null,
      );
      if (parsed.data.initialStock > 0)
        db.prepare(
          "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'receipt', ?, ?, ?, ?)",
        ).run(
          randomUUID(),
          item.homeId,
          item.id,
          locationId,
          parsed.data.initialStock,
          "初始库存",
          `initial:${item.id}`,
          new Date().toISOString(),
        );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return reply.code(201).send({ ...item, sku, locationId });
  },
);

app.post<{
  Params: { homeId: string; type: "receipt" | "issue" };
  Body: unknown;
}>("/api/v1/homes/:homeId/stock/:type", async (request, reply) => {
  if (request.params.type !== "receipt" && request.params.type !== "issue")
    return reply.code(404).send({ code: "NOT_FOUND" });
  const parsed = stockCommandSchema.safeParse(request.body);
  if (!parsed.success)
    return reply
      .code(400)
      .send({ code: "VALIDATION_ERROR", details: parsed.error.flatten() });
  const item = db
    .prepare("SELECT id FROM items WHERE id = ? AND home_id = ? AND active = 1")
    .get(parsed.data.itemId, request.params.homeId);
  if (!item) return reply.code(404).send({ code: "ITEM_NOT_FOUND" });
  if (request.params.type === "issue") {
    const balance = db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ? AND location_id = ?",
      )
      .get(
        request.params.homeId,
        parsed.data.itemId,
        parsed.data.locationId,
      ) as { quantity: number };
    if (balance.quantity < parsed.data.quantity)
      return reply
        .code(409)
        .send({ code: "INSUFFICIENT_STOCK", available: balance.quantity });
  }
  const id = randomUUID();
  try {
    db.prepare(
      "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      request.params.homeId,
      parsed.data.itemId,
      parsed.data.locationId,
      request.params.type,
      parsed.data.quantity,
      parsed.data.reason ?? null,
      parsed.data.idempotencyKey,
      new Date().toISOString(),
    );
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return db
        .prepare(
          "SELECT * FROM stock_transactions WHERE home_id = ? AND idempotency_key = ?",
        )
        .get(request.params.homeId, parsed.data.idempotencyKey);
    throw error;
  }
  return reply.code(201).send({
    id,
    ...parsed.data,
    homeId: request.params.homeId,
    type: request.params.type,
  });
});

app.get<{ Params: { homeId: string } }>(
  "/api/v1/homes/:homeId/shopping-list",
  async (request) => {
    const manual = db
      .prepare(
        "SELECT id, item_id AS itemId, name, quantity, unit, category, location_id AS locationId, source, completed, created_at AS createdAt FROM shopping_list WHERE home_id = ? ORDER BY completed, created_at DESC",
      )
      .all(request.params.homeId);
    const automatic = db
      .prepare(
        "SELECT 'auto:' || items.id AS id, items.id AS itemId, items.name, MAX(items.reorder_point - (SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) FROM stock_transactions WHERE item_id = items.id), 0) AS quantity, items.base_unit AS unit, items.category, items.default_location_id AS locationId, 'automatic' AS source, 0 AS completed, NULL AS createdAt FROM items WHERE items.home_id = ? AND items.active = 1 AND (SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) FROM stock_transactions WHERE item_id = items.id) < items.reorder_point GROUP BY items.id ORDER BY items.name",
      )
      .all(request.params.homeId);
    return [...manual, ...automatic];
  },
);
app.post<{ Params: { homeId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/shopping-list",
  async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    let name = typeof body.name === "string" ? body.name.trim() : "";
    const quantity = Number(body.quantity ?? 1);
    let unit = typeof body.unit === "string" ? body.unit.trim() : null;
    let category =
      typeof body.category === "string" ? body.category.trim() : null;
    let locationId =
      typeof body.locationId === "string" ? body.locationId : null;
    const itemId = typeof body.itemId === "string" ? body.itemId : null;
    if (itemId) {
      const item = db
        .prepare(
          "SELECT name, base_unit AS unit, category, default_location_id AS locationId FROM items WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(itemId, request.params.homeId) as
        | {
            name: string;
            unit: string;
            category: string;
            locationId: string | null;
          }
        | undefined;
      if (!item) return reply.code(400).send({ code: "ITEM_NOT_FOUND" });
      name = item.name;
      unit = item.unit;
      category = item.category;
      locationId = item.locationId;
    }
    if (!name || !Number.isFinite(quantity) || quantity <= 0)
      return reply.code(400).send({ code: "VALIDATION_ERROR" });
    const id = randomUUID();
    db.prepare(
      "INSERT INTO shopping_list (id, home_id, item_id, name, quantity, unit, category, location_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)",
    ).run(
      id,
      request.params.homeId,
      itemId,
      name,
      quantity,
      unit,
      category,
      locationId,
      new Date().toISOString(),
    );
    return reply.code(201).send({
      id,
      name,
      quantity,
      unit,
      category,
      locationId,
      itemId,
      source: "manual",
      completed: 0,
    });
  },
);
app.patch<{ Params: { homeId: string; shoppingId: string }; Body: unknown }>(
  "/api/v1/homes/:homeId/shopping-list/:shoppingId",
  async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const hasCompleted = typeof body.completed === "boolean";
    const completed = Boolean(body.completed);
    const requestedQuantity =
      typeof body.quantity === "number" && body.quantity > 0
        ? body.quantity
        : null;
    if (completed && request.params.shoppingId.startsWith("auto:")) {
      const itemId = request.params.shoppingId.slice(5);
      const item = db
        .prepare(
          "SELECT id, default_location_id AS locationId, base_unit AS unit, reorder_point AS reorderPoint FROM items WHERE id = ? AND home_id = ? AND active = 1",
        )
        .get(itemId, request.params.homeId) as
        | {
            id: string;
            locationId: string | null;
            unit: string;
            reorderPoint: number;
          }
        | undefined;
      if (!item || !item.locationId)
        return reply.code(400).send({ code: "SHOPPING_LOCATION_REQUIRED" });
      const balance = db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN quantity ELSE -quantity END), 0) AS quantity FROM stock_transactions WHERE home_id = ? AND item_id = ?",
        )
        .get(request.params.homeId, itemId) as { quantity: number };
      const quantity =
        requestedQuantity ?? Math.max(item.reorderPoint - balance.quantity, 0);
      if (quantity > 0)
        db.prepare(
          "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'receipt', ?, ?, ?, ?)",
        ).run(
          randomUUID(),
          request.params.homeId,
          itemId,
          item.locationId,
          quantity,
          "采购入库",
          `shopping:auto:${itemId}:${Date.now()}`,
          new Date().toISOString(),
        );
      return {
        id: request.params.shoppingId,
        completed: true,
        received: quantity,
      };
    }
    const row = db
      .prepare(
        "SELECT item_id AS itemId, location_id AS locationId, quantity, completed FROM shopping_list WHERE id = ? AND home_id = ?",
      )
      .get(request.params.shoppingId, request.params.homeId) as
      | {
          itemId: string | null;
          locationId: string | null;
          quantity: number;
          completed: number;
        }
      | undefined;
    if (!row) return reply.code(404).send({ code: "SHOPPING_ITEM_NOT_FOUND" });
    const nextItemId =
      typeof body.itemId === "string" ? body.itemId || null : row.itemId;
    const linkedItem = nextItemId
      ? (db
          .prepare(
            "SELECT name, base_unit AS unit, category, default_location_id AS locationId FROM items WHERE id = ? AND home_id = ? AND active = 1",
          )
          .get(nextItemId, request.params.homeId) as
          | {
              name: string;
              unit: string;
              category: string;
              locationId: string | null;
            }
          | undefined)
      : undefined;
    if (nextItemId && !linkedItem)
      return reply.code(400).send({ code: "ITEM_NOT_FOUND" });
    if (
      hasCompleted &&
      completed &&
      !row.completed &&
      row.itemId &&
      row.locationId
    )
      db.prepare(
        "INSERT INTO stock_transactions (id, home_id, item_id, location_id, type, quantity, reason, idempotency_key, occurred_at) VALUES (?, ?, ?, ?, 'receipt', ?, ?, ?, ?)",
      ).run(
        randomUUID(),
        request.params.homeId,
        row.itemId,
        row.locationId,
        requestedQuantity ?? row.quantity,
        "采购入库",
        `shopping:${request.params.shoppingId}`,
        new Date().toISOString(),
      );
    const result = db
      .prepare(
        hasCompleted
          ? "UPDATE shopping_list SET completed = ?, completed_at = ?, name = COALESCE(?, name), quantity = COALESCE(?, quantity), unit = COALESCE(?, unit), category = COALESCE(?, category), location_id = COALESCE(?, location_id), item_id = COALESCE(?, item_id) WHERE id = ? AND home_id = ?"
          : "UPDATE shopping_list SET name = COALESCE(?, name), quantity = COALESCE(?, quantity), unit = COALESCE(?, unit), category = COALESCE(?, category), location_id = ?, item_id = ? WHERE id = ? AND home_id = ?",
      )
      .run(
        ...(hasCompleted
          ? [completed ? 1 : 0, completed ? new Date().toISOString() : null]
          : []),
        linkedItem?.name ??
          (typeof body.name === "string" ? body.name.trim() : null),
        typeof body.quantity === "number" ? body.quantity : null,
        linkedItem?.unit ??
          (typeof body.unit === "string" ? body.unit : null),
        linkedItem?.category ??
          (typeof body.category === "string" ? body.category : null),
        linkedItem
          ? linkedItem.locationId
          : typeof body.locationId === "string"
            ? body.locationId
            : null,
        nextItemId,
        request.params.shoppingId,
        request.params.homeId,
      );
    if (!result.changes)
      return reply.code(404).send({ code: "SHOPPING_ITEM_NOT_FOUND" });
    return { id: request.params.shoppingId, completed };
  },
);
app.delete<{ Params: { homeId: string; shoppingId: string } }>(
  "/api/v1/homes/:homeId/shopping-list/:shoppingId",
  async (request, reply) => {
    const result = db
      .prepare("DELETE FROM shopping_list WHERE id = ? AND home_id = ?")
      .run(request.params.shoppingId, request.params.homeId);
    return result.changes
      ? { id: request.params.shoppingId, deleted: true }
      : reply.code(404).send({ code: "SHOPPING_ITEM_NOT_FOUND" });
  },
);

app.all("/mcp", async (request, reply) => handleMcpRequest(request, reply, db));

const staticRoot = resolve(process.env.STATIC_ROOT ?? "./public");
if (existsSync(staticRoot)) {
  await app.register(fastifyStatic, { root: staticRoot });
  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      !request.url.startsWith("/mcp")
    )
      return reply.sendFile("index.html");
    return reply.code(404).send({ code: "NOT_FOUND" });
  });
}

const port = Number(process.env.PORT ?? 8080);
app
  .listen({ host: process.env.BIND_ADDRESS ?? "0.0.0.0", port })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
