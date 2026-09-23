import assert from "node:assert/strict";
import {test} from "node:test";
import {adjacentMonth,isPurchaseOverdue,localToday} from "./purchaseSchedule.js";
test("overdue is a display state and completed or undated purchases are not overdue",()=>{
  const item={plannedDate:"2026-08-31",completed:false};
  assert.equal(isPurchaseOverdue(item,"2026-09-01"),true);
  assert.equal(item.plannedDate,"2026-08-31");
  assert.equal(isPurchaseOverdue({...item,completed:true},"2026-09-01"),false);
  assert.equal(isPurchaseOverdue({plannedDate:null},"2026-09-01"),false);
  assert.equal(isPurchaseOverdue({plannedDate:"2026-09-01"},"2026-09-01"),false);
  assert.equal(isPurchaseOverdue({plannedDate:"2026-09-02"},"2026-09-01"),false);
});
test("month arrows cross year boundaries",()=>{
  assert.equal(adjacentMonth("2026-01",-1),"2025-12");
  assert.equal(adjacentMonth("2026-12",1),"2027-01");
});
test("overdue treats numeric completion flags like boolean completion flags",()=>{
  assert.equal(isPurchaseOverdue({plannedDate:"2026-08-31",completed:0},"2026-09-01"),true);
  assert.equal(isPurchaseOverdue({plannedDate:"2026-08-31",completed:1},"2026-09-01"),false);
});
test("localToday formats the supplied local date without timezone conversion",()=>{
  assert.equal(localToday(new Date(2026,0,5,23,59,59)),"2026-01-05");
});
