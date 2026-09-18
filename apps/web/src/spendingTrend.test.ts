import assert from "node:assert/strict";
import {test} from "node:test";
import {spendingTrendScale} from "./spendingTrend.js";

test("monthly budgets share a scale with the highest budget at 75 percent",()=>{
  const scale=spendingTrendScale([{budget:300,actual:350,planned:20},{budget:150,actual:100,planned:0}]);
  assert.equal(scale,400);
  assert.equal(300/scale,.75);
  assert.equal(150/scale,.375);
  assert.equal(370/scale,.925);
});
test("large overspending stays visible and missing budgets use spending",()=>{
  assert.equal(spendingTrendScale([{budget:300,actual:450,planned:120}]),600);
  assert.equal(spendingTrendScale([{budget:null,actual:120,planned:30}]),200);
  assert.equal(spendingTrendScale([{budget:0,actual:0,planned:0}]),1);
  assert.equal(spendingTrendScale([]),1);
});
