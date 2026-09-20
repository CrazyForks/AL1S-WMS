import assert from "node:assert/strict";
import {test} from "node:test";
import {groupCohorts,type CohortPoint} from "./inventoryCohorts.js";

const point=(label:string,originalCost:number,usedCost:number,unknownCostBatchCount=0):CohortPoint=>({label,originalCost,usedCost,wastedCost:0,adjustmentCost:0,remainingCost:originalCost-usedCost,unknownCostBatchCount,usedShare:null});
test("quarter and year groups preserve costs and recalculate weighted shares",()=>{
  const points=[point("2025-12",50,25),point("2026-01",100,100),point("2026-02",300,0),point("2026-03",0,0,2),point("2026-04",100,50)];
  const quarters=groupCohorts(points,"quarter");
  assert.deepEqual(quarters.map(row=>row.label),["2025 Q4","2026 Q1","2026 Q2"]);
  assert.equal(quarters[1].originalCost,400);
  assert.equal(quarters[1].usedShare,25);
  assert.equal(quarters[1].remainingCost,300);
  assert.equal(quarters[1].unknownCostBatchCount,2);
  const years=groupCohorts(points,"year");
  assert.equal(years[1].originalCost,500);
  assert.equal(years[1].usedShare,30);
  assert.equal(groupCohorts(points,"month").length,5);
});
test("unknown-only and zero-cost groups have no invented percentage",()=>{
  assert.equal(groupCohorts([point("2026-01",0,0,1)],"year")[0].usedShare,null);
  assert.deepEqual(groupCohorts([],"quarter"),[]);
});
