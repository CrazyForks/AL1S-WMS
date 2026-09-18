import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase } from "@al1s-wms/db";
import { buildApp } from "../app.js";
import { displayUnit, localizeReason, parseAcceptLanguage, translate } from "./index.js";

test("Accept-Language parsing is strict and negotiates supported locales", () => {
  assert.equal(parseAcceptLanguage(undefined), "zh-CN");
  assert.equal(parseAcceptLanguage("fr-FR"), "zh-CN");
  assert.equal(parseAcceptLanguage("en-US"), "en-US");
  assert.equal(parseAcceptLanguage("en-GB"), "en-US");
  assert.equal(parseAcceptLanguage("en;q=0.8, zh-CN;q=0.9"), "zh-CN");
  assert.equal(parseAcceptLanguage("fr-FR, en-US;q=0.7"), "en-US");
  assert.equal(parseAcceptLanguage("en-US;q=.8"), "zh-CN");
  assert.equal(parseAcceptLanguage("en-US;q=0.8;level=1"), "zh-CN");
  assert.equal(parseAcceptLanguage("en-US,,zh-CN"), "zh-CN");
});

test("translate requires catalog keys and interpolates values", () => {
  assert.equal(
    translate("en-US", "error.insufficientStock", { available: 2 }),
    "Insufficient stock at this location; available: 2",
  );
  assert.equal(displayUnit("en-US", "瓶"), "bottle(s)");
  assert.equal(displayUnit("en-US", "根"), "piece(s)");
  assert.equal(displayUnit("en-US", "克"), "g");
  assert.equal(displayUnit("zh-CN", "瓶"), "瓶");
  assert.equal(localizeReason("en-US","reason.initialStock"),"Initial stock");
  assert.equal(localizeReason("en-US","初始库存"),"Initial stock");
});

test("HTTP errors honor locale while default Chinese contracts stay compatible", async () => {
  const db = openDatabase(":memory:");
  const userId = randomUUID();
  const sessionId = randomUUID();
  db.prepare(
    "INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)",
  ).run(userId, "locale-user", "invalid", new Date().toISOString());
  db.prepare(
    "INSERT INTO sessions(id,user_id,expires_at) VALUES (?,?,?)",
  ).run(sessionId, userId, new Date(Date.now() + 60_000).toISOString());
  const app = await buildApp(db);

  const login = (acceptLanguage?: string) =>
    app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
      payload: { username: "missing", password: "wrong" },
    });

  const fallback = await login();
  assert.equal(fallback.statusCode, 401);
  assert.deepEqual(fallback.json(), {
    code: "INVALID_CREDENTIALS",
    message: "用户名或密码错误",
  });
  assert.deepEqual((await login("zh-CN")).json(), fallback.json());
  assert.deepEqual((await login("de-DE")).json(), fallback.json());
  assert.deepEqual((await login("en-US;q=.8")).json(), fallback.json());
  assert.deepEqual((await login("en-US")).json(), {
    code: "INVALID_CREDENTIALS",
    message: "Incorrect username or password",
  });

  const unauthenticatedDefault = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
  });
  assert.equal(unauthenticatedDefault.statusCode, 401);
  assert.deepEqual(unauthenticatedDefault.json(), { code: "UNAUTHENTICATED" });
  const unauthenticatedEnglish = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: { "accept-language": "en-US" },
  });
  assert.deepEqual(unauthenticatedEnglish.json(), {
    code: "UNAUTHENTICATED",
    message: "Authentication required",
  });

  const authenticated = {
    cookie: `session=${sessionId}`,
    "accept-language": "en-US",
  };
  const legacyValidation = await app.inject({
    method: "POST",
    url: `/api/v1/homes/${randomUUID()}/items`,
    headers: { cookie: `session=${sessionId}` },
    payload: {},
  });
  assert.equal(legacyValidation.statusCode, 400);
  assert.equal(legacyValidation.json().code, "VALIDATION_ERROR");
  assert.ok(legacyValidation.json().details);
  assert.equal("message" in legacyValidation.json(), false);

  const validation = await app.inject({
    method: "GET",
    url: `/api/v1/homes/${randomUUID()}/shopping-calendar?month=invalid`,
    headers: authenticated,
  });
  assert.equal(validation.statusCode, 400);
  assert.equal(validation.json().code, "VALIDATION_ERROR");
  assert.equal(validation.json().message, "Invalid request parameters");
  assert.ok(validation.json().details);

  const inventory = await app.inject({
    method: "GET",
    url: `/api/v1/homes/${randomUUID()}/barcodes/3017620422004`,
    headers: authenticated,
  });
  assert.equal(inventory.statusCode, 400);
  assert.deepEqual(inventory.json(), {
    code: "INVALID_BARCODE_CHECKSUM",
    message: "Invalid barcode check digit",
  });

  const deletion = await app.inject({
    method: "DELETE",
    url: `/api/v1/homes/${randomUUID()}/items/${randomUUID()}`,
    headers: authenticated,
  });
  assert.equal(deletion.statusCode, 404);
  assert.deepEqual(deletion.json(), {
    message: "Object not found or already deleted",
  });

  const homeId = randomUUID();
  db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(homeId, "测试家庭");
  db.prepare(
    "INSERT INTO items(id,home_id,sku,name,category,base_unit,reorder_point) VALUES (?,?,?,?,?,?,?)",
  ).run(randomUUID(), homeId, randomUUID(), "牛奶", "食品", "瓶", 2);
  const overviewChinese = await app.inject({
    method: "GET",
    url: `/api/v1/homes/${homeId}/overview`,
    headers: { cookie: `session=${sessionId}` },
  });
  assert.equal(
    overviewChinese.json().recommendedActions[0].message,
    "牛奶 建议补充 2 瓶",
  );
  const overviewEnglish = await app.inject({
    method: "GET",
    url: `/api/v1/homes/${homeId}/overview`,
    headers: authenticated,
  });
  assert.equal(
    overviewEnglish.json().recommendedActions[0].message,
    "Replenish 牛奶 by 2 bottle(s)",
  );

  await app.close();
  db.close();
});
