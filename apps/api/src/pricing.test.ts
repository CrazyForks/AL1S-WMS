import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase, seedShoppingChannels } from "@al1s-wms/db";
import { financialDashboard, financialSummary, itemPriceHistory, saveFinancialBudget } from "./pricing.js";
import { listItems } from "./queries.js";
import { receiveShopping, saveShopping } from "./shopping.js";
import { recordStock } from "./stock.js";

function fixture() {
  const db=openDatabase(":memory:"),homeId=randomUUID(),locationId=randomUUID(),itemId=randomUUID();
  db.prepare("INSERT INTO homes(id,name,default_currency) VALUES (?,?,'CNY')").run(homeId,"家");
  seedShoppingChannels(db,homeId);
  const channelId=db.prepare("SELECT id FROM shopping_channels WHERE home_id=? AND name='京东'").get(homeId)?.id as string;
  db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(locationId,homeId,"储物柜");
  db.prepare("INSERT INTO items(id,home_id,sku,name,category,base_unit,default_location_id) VALUES (?,?,?,?,?,?,?)").run(itemId,homeId,itemId,"乌龙茶","饮品","瓶",locationId);
  return {db,homeId,locationId,itemId,channelId};
}

test("category-only budgets persist and descendants share their ancestor budget",()=>{
  const {db,homeId,locationId,itemId}=fixture();
  const root=randomUUID(),child=randomUUID(),grandchild=randomUUID();
  const insert=db.prepare("INSERT INTO item_categories(id,home_id,name,parent_id) VALUES (?,?,?,?)");
  insert.run(root,homeId,"食品",null);
  insert.run(child,homeId,"饮品",root);
  insert.run(grandchild,homeId,"茶饮",child);
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,totalPrice:120,purchaseDate:"2026-09-03",idempotencyKey:"child"});
  db.prepare("UPDATE items SET category='茶饮' WHERE id=?").run(itemId);
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,totalPrice:100,purchaseDate:"2026-09-04",idempotencyKey:"grandchild"});
  saveShopping(db,homeId,{itemId,quantity:1,plannedDate:"2026-09-20",estimatedTotal:90});
  saveFinancialBudget(db,homeId,{month:"2026-09",total:null,categoryBudgets:[{category:"食品",amount:300}]});
  const result=financialDashboard(db,homeId,{month:"2026-09"});
  assert.equal(result.budgetTotal,300);
  assert.equal(result.remainingBudget,-10);
  assert.deepEqual(result.byCategory,[{category:"食品",actual:220,planned:90,budget:300}]);
  assert.deepEqual(result.categoryBudgets.map(row=>({...row})),[{category:"食品",amount:300}]);
  assert.equal(financialDashboard(db,homeId,{month:"2026-10"}).budgetTotal,300);
  assert.throws(()=>saveFinancialBudget(db,homeId,{month:"2026-09",total:500,categoryBudgets:[{category:"食品",amount:300},{category:"茶饮",amount:100}]}));
  assert.equal(financialDashboard(db,homeId,{month:"2026-09"}).budgetTotal,300);
  db.prepare("UPDATE items SET category='清洁用品' WHERE id=?").run(itemId);
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,totalPrice:15,purchaseDate:"2026-09-05",idempotencyKey:"outside"});
  const updated=financialDashboard(db,homeId,{month:"2026-09"});
  assert.deepEqual(updated.byCategory.find(row=>row.category==="清洁用品"),{category:"清洁用品",actual:15,planned:0,budget:null});
  assert.equal(updated.spendingTotal,235);
  db.close();
});

test("batch costs produce price history, spending, budget, and remaining inventory value",()=>{
  const {db,homeId,locationId,itemId,channelId}=fixture();
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:10,totalPrice:20,purchaseDate:"2026-09-03",expiryDate:"2027-01-01",channelId,idempotencyKey:"priced"});
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:5,idempotencyKey:"unknown"});
  recordStock(db,homeId,"issue",{itemId,locationId,quantity:4,idempotencyKey:"consume"});
  saveShopping(db,homeId,{itemId,quantity:12,channelId,plannedDate:"2026-09-20",estimatedTotal:30});
  const summary=financialSummary(db,homeId,{month:"2026-09"});
  assert.equal(summary.spendingTotal,20);
  assert.equal(summary.estimatedTotal,30);
  assert.equal(summary.variance,-10);
  assert.equal(summary.inventoryValue,12);
  assert.equal(summary.pricedBatchCount,1);
  assert.equal(summary.unknownBatchCount,1);
  assert.equal(summary.byChannel[0].channelName,"京东");
  const history=itemPriceHistory(db,homeId,itemId);
  assert.equal(history.items[0].totalPrice,20);
  assert.equal(history.items[0].unitPrice,2);
  const inventory=listItems(db,homeId,{}) as unknown as {lastUnitPrice:number}[];
  assert.equal(inventory[0].lastUnitPrice,2);
  db.close();
});

test("shopping receipt inherits channel and records actual total on its batch",()=>{
  const {db,homeId,locationId,itemId,channelId}=fixture();
  const purchase=saveShopping(db,homeId,{itemId,quantity:3,channelId,plannedDate:"2026-09-20",estimatedTotal:9});
  const received=receiveShopping(db,homeId,purchase.id,{actualQuantity:3,totalPrice:8.4,purchaseDate:"2026-09-20",idempotencyKey:"receive-price"});
  assert.equal(received.estimatedTotal,9);
  assert.equal(received.actualTotal,8.4);
  const batch=db.prepare("SELECT purchase_total_minor AS total,channel_id AS channelId,purchased_date AS purchaseDate,shopping_item_id AS shoppingItemId,purchase_category AS purchaseCategory FROM stock_batches WHERE item_id=?").get(itemId);
  assert.equal(batch?.total,840);
  assert.equal(batch?.channelId,channelId);
  assert.equal(batch?.purchaseDate,"2026-09-20");
  assert.equal(batch?.shoppingItemId,purchase.id);
  assert.equal(batch?.purchaseCategory,"饮品");
  const suggested=saveShopping(db,homeId,{itemId,quantity:2,channelId,plannedDate:"2026-10-01"});
  assert.equal(suggested.estimatedTotal,5.6);
  db.close();
});

test("financial dashboard combines budgets, plans, purchases, and valuation",()=>{
  const {db,homeId,locationId,itemId,channelId}=fixture();
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:4,totalPrice:12,purchaseDate:"2026-09-04",channelId,idempotencyKey:"dashboard-receipt"});
  saveShopping(db,homeId,{itemId,quantity:2,plannedDate:"2026-09-18",estimatedTotal:8});
  saveFinancialBudget(db,homeId,{month:"2026-09",total:30,categoryBudgets:[{category:"饮品",amount:20},{category:"食品",amount:5}]});
  const dashboard=financialDashboard(db,homeId,{month:"2026-09"});
  assert.equal(dashboard.budgetTotal,30);
  assert.equal(dashboard.forecastTotal,20);
  assert.equal(dashboard.remainingBudget,10);
  assert.equal(dashboard.byCategory[0].budget,20);
  assert.deepEqual(dashboard.byCategory.find(row=>row.category==="食品"),{category:"食品",actual:0,planned:0,budget:5});
  assert.equal(dashboard.purchases[0].variance,null);
  assert.equal(dashboard.valuation.byItem[0].itemName,"乌龙茶");
  assert.equal(dashboard.valuation.byItem[0].value,12);
  assert.equal(dashboard.valuation.byCategory[0].category,"饮品");
  assert.equal(dashboard.valuation.byLocation[0].locationId,locationId);
  assert.equal(dashboard.trend.length,12);
  const inherited=financialDashboard(db,homeId,{month:"2026-10"});
  assert.equal(inherited.budgetTotal,30);
  assert.equal(inherited.budgetMode,"inherited");
  assert.equal(inherited.budgetSourceMonth,"2026-09");
  assert.throws(()=>saveFinancialBudget(db,homeId,{month:"2026-09",total:10,categoryBudgets:[{category:"饮品",amount:11}]}));
  db.close();
});
