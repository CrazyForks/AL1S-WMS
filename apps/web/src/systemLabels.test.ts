import assert from "node:assert/strict";
import { test } from "node:test";
import { enUS } from "./i18n/locales/en-US.js";

test("localizes only built-in category and shopping channel labels", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-US", languages: ["en-US"] },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { lang: "" } },
  });
  const { setLocale } = await import("./i18n/index.js");
  const { categoryLabel, channelLabel } = await import("./systemLabels.js");
  await setLocale("en-US");
  assert.equal(categoryLabel("食品"), "Food");
  assert.equal(channelLabel("京东"), "JD");
  assert.equal(categoryLabel("自定义分类"), "自定义分类");
  assert.equal(channelLabel("社区商店"), "社区商店");
  await setLocale("zh-CN");
  assert.equal(categoryLabel("食品"), "食品");
});

test("English command labels keep word boundaries", () => {
  assert.equal(enUS["＋ 添加采购项"], "+ Add purchase item");
  assert.equal(enUS.添加采购项, "Add purchase item");
  assert.equal(enUS.编辑采购项, "Edit purchase item");
  assert.equal(enUS.扫描条码, "Scan barcode");
});
