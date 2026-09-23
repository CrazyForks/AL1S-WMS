import assert from "node:assert/strict";
import { test } from "node:test";
import { roundQuantity } from "./quantity.js";

test("fractional inventory has two-decimal precision without negative-zero shortages", () => {
  assert.equal(roundQuantity(0.66700000001), 0.67);
  assert.equal(roundQuantity(0.1 + 0.2), 0.3);
  assert.equal(roundQuantity(0.67 - 0.66700000001), 0);
  assert.equal(roundQuantity(-5.551115123125783e-17), 0);
});
