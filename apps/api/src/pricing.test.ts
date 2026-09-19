import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, beforeEach, afterEach, mock } from "node:test";
import { openDatabase, seedShoppingChannels } from "@al1s-wms/db";
import { financialDashboard, financialSummary, financialTrend, listPurchaseRecords, itemPriceHistory, saveFinancialBudget } from "./pricing.js";
import { listItems } from "./queries.js";
import { receiveShopping, saveShopping } from "./shopping.js";
import { recordStock } from "./stock.js";

beforeEach(()=>mock.timers.enable({apis:["Date"],now:new Date("2026-09-18T12:00:00Z")}));
afterEach(()=>mock.timers.reset());

test("trend ranges compare matching elapsed dates and historical full periods",()=>{
  const {db,homeId,itemId,locationId}=fixture();
  for(const [date,total] of [["2025-09-10",10],["2026-08-10",20],["2026-08-25",100],["2026-09-10",40]] as const){
    recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,totalPrice:total,idempotencyKey:date});
    db.prepare("UPDATE stock_batches SET received_at=? WHERE id=(SELECT batch_id FROM stock_transactions WHERE idempotency_key=?)").run(`${date}T10:00:00.000Z`,`${date}:0`);
  }
  const current=financialTrend(db,homeId,{start:"2026-09",end:"2026-09"});
  assert.equal(current.current.actual,40);
  assert.equal(current.previous.actual,20);
  assert.equal(current.previous.end,"2026-08-18");
  assert.equal(current.previous.percent,100);
  assert.equal(current.yearAgo.actual,10);
  assert.equal(current.yearAgo.percent,300);
  const previous=financialTrend(db,homeId,{start:"2026-08",end:"2026-08"});
  assert.equal(previous.current.actual,120);
  assert.equal(previous.previous.end,"2026-07-31");
  assert.equal(previous.previous.percent,null);
  const year=financialTrend(db,homeId,{start:"2026-01",end:"2026-12"});
  assert.equal(year.points.length,12);
  assert.equal(year.current.actual,160);
  assert.equal(year.yearAgo.end,"2025-09-18");
  assert.throws(()=>financialTrend(db,homeId,{start:"2026-09",end:"2026-08"}));
  assert.throws(()=>financialTrend(db,homeId,{start:"2020-01",end:"2026-09"}));
  db.close();
});

test("purchase pagination includes all records, date boundaries and stable tied timestamps",()=>{
  const {db,homeId,itemId,locationId}=fixture();
  for(let index=0;index<205;index++)recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,totalPrice:1,idempotencyKey:`page-${index}`});
  const query={start:"2026-09-18",end:"2026-09-18",pageSize:100};
  const pages=[1,2,3].map(page=>listPurchaseRecords(db,homeId,{...query,page}));
  assert.deepEqual(pages.map(page=>page.items.length),[100,100,5]);
  assert.equal(new Set(pages.flatMap(page=>page.items.map(row=>row.batchId))).size,205);
  assert.equal(pages[2].total,205);
  assert.equal(pages[2].amount,205);
  assert.equal(pages[2].totalPages,3);
  assert.equal(listPurchaseRecords(db,homeId,{...query,page:99}).page,3);
  assert.equal(listPurchaseRecords(db,homeId,{...query,end:"2026-09-19",start:"2026-09-19"}).total,0);
  assert.throws(()=>listPurchaseRecords(db,homeId,{start:"2026-09-19",end:"2026-09-18"}));
  assert.throws(()=>listPurchaseRecords(db,homeId,{...query,pageSize:101}));
  db.close();
});

test("financial spending follows receipt time, not planned or purchase dates",()=>{
  const {db,homeId,itemId,channelId}=fixture();
  const purchase=saveShopping(db,homeId,{itemId,quantity:2,channelId,plannedDate:"2026-08-01",estimatedTotal:100});
  assert.equal(financialDashboard(db,homeId,{month:"2026-08"}).spendingTotal,0);
  receiveShopping(db,homeId,purchase.id,{actualQuantity:2,totalPrice:95,purchaseDate:"2026-07-01",idempotencyKey:"late-receipt"});
  const current=financialDashboard(db,homeId,{month:"2026-09"});
  assert.equal(current.spendingTotal,95);
  assert.equal(current.byCategory[0].actual,95);
  assert.equal(current.byChannel[0].total,95);
  assert.equal(current.purchases.length,1);
  assert.equal(current.trend.at(-1)?.actual,95);
  for(const month of ["2026-07","2026-08"]){
    const previous=financialDashboard(db,homeId,{month});
    assert.equal(previous.spendingTotal,0);
    assert.equal(previous.purchases.length,0);
    assert.equal(previous.estimatedTotal,0);
  }
  assert.equal(db.prepare("SELECT planned_date FROM shopping_list WHERE id=?").get(purchase.id)?.planned_date,"2026-08-01");
  db.close();
});

test("financial month ranges include receipts and plans on the final day",()=>{
  const {db,homeId,itemId,locationId}=fixture();
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,totalPrice:12,idempotencyKey:"month-end"});
  db.prepare("UPDATE stock_batches SET received_at=? WHERE item_id=?").run("2026-09-30T23:59:59.000Z",itemId);
  saveShopping(db,homeId,{itemId,quantity:1,plannedDate:"2026-09-30",estimatedTotal:8});
  const dashboard=financialDashboard(db,homeId,{month:"2026-09"});
  assert.equal(dashboard.spendingTotal,12);
  assert.equal(dashboard.estimatedTotal,8);
  assert.equal(listPurchaseRecords(db,homeId,{start:"2026-09-30",end:"2026-09-30"}).total,1);
  db.close();
});

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
  assert.deepEqual(result.categorySpending.find(row=>row.category==="饮品"),{category:"饮品",actual:120,planned:0});
  assert.deepEqual(result.categorySpending.find(row=>row.category==="茶饮"),{category:"茶饮",actual:100,planned:90});
  assert.deepEqual(result.categoryBudgets.map(row=>({...row})),[{category:"食品",amount:300}]);
  assert.equal(financialDashboard(db,homeId,{month:"2026-10"}).budgetTotal,300);
  assert.throws(()=>saveFinancialBudget(db,homeId,{month:"2026-09",total:500,categoryBudgets:[{category:"食品",amount:300},{category:"茶饮",amount:301}]}));
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

test("nested budgets reserve child limits without adding them to the monthly total",()=>{
  const {db,homeId,locationId,itemId}=fixture();
  const root=randomUUID(),child=randomUUID();
  const insert=db.prepare("INSERT INTO item_categories(id,home_id,name,parent_id) VALUES (?,?,?,?)");
  insert.run(root,homeId,"食品",null);
  insert.run(child,homeId,"饮品",root);
  insert.run(randomUUID(),homeId,"茶饮",child);
  insert.run(randomUUID(),homeId,"水果",root);
  const save=(categoryBudgets:{category:string;amount:number}[],total:number|null=null)=>saveFinancialBudget(db,homeId,{month:"2026-09",total,categoryBudgets});
  const food={category:"食品",amount:300},drink={category:"饮品",amount:100},tea={category:"茶饮",amount:40};
  const onlyTea=save([tea]);
  assert.equal(onlyTea.budgetTotal,40);
  const nested=save([tea,food,drink]);
  assert.equal(nested.budgetTotal,300);
  assert.equal(save([food,drink,tea],300).budgetTotal,300);
  // A skipped middle level still reserves the grandchild from its nearest budget.
  assert.equal(save([tea,food]).budgetTotal,300);
  save([food,drink,tea]);
  for(const [category,cost] of [["食品",25],["饮品",30],["茶饮",45]] as const) {
    db.prepare("UPDATE items SET category=? WHERE id=?").run(category,itemId);
    recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,totalPrice:cost,purchaseDate:"2026-09-18",idempotencyKey:category});
  }
  saveShopping(db,homeId,{itemId,quantity:1,plannedDate:"2026-09-20",estimatedTotal:10});
  const result=financialDashboard(db,homeId,{month:"2026-09"});
  assert.equal(result.spendingTotal,100);
  assert.equal(result.forecastTotal,110);
  assert.equal(result.remainingBudget,190);
  assert.deepEqual(result.byCategory.find(row=>row.category==="食品"),{category:"食品",actual:100,planned:10,budget:300});
  assert.deepEqual(result.byCategory.find(row=>row.category==="饮品"),{category:"饮品",actual:75,planned:10,budget:100});
  assert.deepEqual(result.byCategory.find(row=>row.category==="茶饮"),{category:"茶饮",actual:45,planned:10,budget:40});
  assert.throws(()=>save([food,drink,tea,{category:"水果",amount:201}]),{code:"CHILD_BUDGET_EXCEEDS_PARENT"});
  assert.throws(()=>save([food,{...drink,amount:39},tea]),{code:"CHILD_BUDGET_EXCEEDS_PARENT"});
  assert.throws(()=>save([food,drink,tea],299));
  assert.equal(financialDashboard(db,homeId,{month:"2026-10"}).budgetTotal,300);
  // Removing only the parent preserves the children as standalone limits.
  assert.equal(save([drink,tea]).budgetTotal,100);
  assert.equal(financialDashboard(db,homeId,{month:"2026-09"}).byCategory.find(row=>row.category==="食品")?.budget,null);
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
  assert.deepEqual(dashboard.valuation.byItem[0].locations,["储物柜"]);
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

test("inventory valuation lists every location for an item",()=>{
  const {db,homeId,locationId,itemId}=fixture();
  const secondLocationId=randomUUID();
  db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(secondLocationId,homeId,"客厅储物架");
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,totalPrice:4,idempotencyKey:"valuation-first"});
  recordStock(db,homeId,"receipt",{itemId,locationId:secondLocationId,quantity:2,totalPrice:6,idempotencyKey:"valuation-second"});
  const valuation=financialDashboard(db,homeId,{month:"2026-09"}).valuation.byItem;
  assert.deepEqual(valuation,[{itemId,itemName:"乌龙茶",category:"饮品",quantity:3,unit:"瓶",locations:["储物柜","客厅储物架"],value:10}]);
  db.close();
});
