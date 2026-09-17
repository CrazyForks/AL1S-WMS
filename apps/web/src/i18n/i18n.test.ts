import assert from "node:assert/strict";
import { test } from "node:test";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";

function placeholders(value: string) {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)]
    .map((match) => match[1])
    .sort();
}

test("locale catalogs have identical keys and interpolation parameters", () => {
  assert.deepEqual(Object.keys(enUS).sort(), Object.keys(zhCN).sort());
  for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
    assert.deepEqual(placeholders(enUS[key]), placeholders(zhCN[key]), key);
  }
});

test("saved locale wins, browser English is detected, and API locale follows", async () => {
  let savedLocale: string | null = "zh-CN";
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => savedLocale,
      setItem: (_key: string, value: string) => {
        savedLocale = value;
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-GB", languages: ["en-GB"] },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { lang: "" } },
  });

  const locale = await import("./index.js");
  assert.equal(locale.detectLocale(), "zh-CN");
  savedLocale = null;
  assert.equal(locale.detectLocale(), "en-US");

  await locale.setLocale("zh-CN");
  assert.equal(locale.displayUnit("瓶"), "瓶");
  await locale.setLocale("en-US");
  assert.equal(locale.displayUnit("瓶"), "bottle(s)");
  assert.equal(locale.displayUnit("自定义单位"), "自定义单位");

  let sentHeaders: Headers | undefined;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentHeaders = new Headers(init?.headers);
      return new Response();
    },
  });
  const { apiFetch } = await import("./apiFetch.js");
  await apiFetch("/api/v1/setup/status");
  assert.equal(sentHeaders?.get("Accept-Language"), "en-US");

  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: originalFetch,
  });
});
