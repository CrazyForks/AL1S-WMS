import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase, seedShoppingChannels } from "@al1s-wms/db";
import { getHomeOverview, listBatches, listItems, listTransactions } from "./queries.js";
import { receiveShopping, saveShopping } from "./shopping.js";
import { InventoryError, reconcileStock, recordStock } from "./stock.js";

function fixture() {
  const db = openDatabase(":memory:");
  const homeId = randomUUID(), locationId = randomUUID(), itemId = randomUUID();
  db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(homeId,"测试家庭");
  db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(locationId,homeId,"储物柜");
  db.prepare("INSERT INTO items(id,home_id,sku,name,category,base_unit,default_location_id) VALUES (?,?,?,?,?,?,?)")
    .run(itemId,homeId,itemId,"牛奶","食品","瓶",locationId);
  return {db,homeId,locationId,itemId};
}

test("item query is unambiguous and supports paged results", () => {
  const {db,homeId,itemId} = fixture();
  const rows = listItems(db,homeId,{}) as {id:string}[];
  assert.deepEqual(rows.map(row=>row.id),[itemId]);
  const page = listItems(db,homeId,{paged:"true",limit:"1",offset:"0"}) as unknown as {items:{id:string}[];total:number};
  assert.equal(page.total,1);
  assert.equal(page.items[0].id,itemId);
  db.close();
});

test("item query includes the most recent receipt time", () => {
  const {db,homeId,itemId,locationId}=fixture();
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:1,idempotencyKey:"latest-receipt"});
  db.prepare("UPDATE stock_batches SET received_at=? WHERE item_id=?").run("2026-09-18T12:00:00.000Z",itemId);
  const item=listItems(db,homeId,{}) as {latestReceivedAt:string|null}[];
  assert.equal(item[0].latestReceivedAt,"2026-09-18T12:00:00.000Z");
  db.close();
});

test("receipts create batches and issues allocate FEFO idempotently", () => {
  const {db,homeId,locationId,itemId} = fixture();
  const receive = (quantity:number, expiryDate:string|null, key:string) =>
    recordStock(db,homeId,"receipt",{itemId,locationId,quantity,expiryDate,idempotencyKey:key});
  const late = receive(5,"2027-06-01","late").transactions[0].batchId;
  const early = receive(3,"2027-01-01","early").transactions[0].batchId;
  const undated = receive(2,null,"undated").transactions[0].batchId;
  assert.equal(db.prepare("SELECT reason FROM stock_transactions WHERE idempotency_key='early:0'").get()?.reason,"reason.newBatch");
  const issueInput = {itemId,locationId,quantity:6,idempotencyKey:"issue-fefo"};
  const issued = recordStock(db,homeId,"issue",issueInput);
  assert.deepEqual(issued.transactions.map(row=>[row.batchId,row.quantity]),[[early,3],[late,3]]);
  assert.equal(issued.issueReason,"used");
  assert.deepEqual(db.prepare("SELECT DISTINCT reason FROM stock_transactions WHERE type='issue'").all().map(row=>row.reason),["reason.fefoIssue"]);
  const englishHistory=listTransactions(db,homeId,{type:"issue"},"en-US") as unknown as {items:{reason:string}[]};
  assert.equal(englishHistory.items[0].reason,"Issue by earliest expiry");
  assert.deepEqual(recordStock(db,homeId,"issue",issueInput),issued);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM stock_transactions WHERE type='issue'").get() as {n:number}).n,2);
  const batches = listBatches(db,homeId,{itemId,includeEmpty:"true"}) as unknown as {items:{batchId:string;quantity:number}[]};
  assert.deepEqual(new Map(batches.items.map(row=>[row.batchId,row.quantity])),new Map([[early,0],[late,2],[undated,2]]));
  assert.throws(
    () => recordStock(db,homeId,"issue",{itemId,locationId,batchId:early,quantity:1,idempotencyKey:"empty-batch"}),
    (error:unknown) => error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK",
  );
  recordStock(db,homeId,"issue",{itemId,locationId,quantity:1,idempotencyKey:"expired-disposal",issueReason:"expired"});
  recordStock(db,homeId,"issue",{itemId,locationId,quantity:1,idempotencyKey:"damaged-disposal",issueReason:"damaged"});
  assert.deepEqual(
    db.prepare("SELECT issue_reason AS issueReason FROM stock_transactions WHERE idempotency_key IN ('expired-disposal:0','damaged-disposal:0') ORDER BY issue_reason").all().map(row=>row.issueReason),
    ["damaged","expired"],
  );
  db.close();
});

test("shopping receipt creates one batch and safe retries do not duplicate stock", () => {
  const {db,homeId,locationId} = fixture();
  const purchase = saveShopping(db,homeId,{name:"纸巾",quantity:4,unit:"包",category:"日用品",locationId});
  const input = {actualQuantity:5,idempotencyKey:"purchase-retry",manufacturedDate:"2026-09-01",expiryDate:"2028-09-01"};
  const first = receiveShopping(db,homeId,purchase.id,input);
  const second = receiveShopping(db,homeId,purchase.id,input);
  assert.deepEqual(second,first);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM stock_transactions WHERE item_id=?").get(first.itemId) as {n:number}).n,1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM stock_batches WHERE item_id=?").get(first.itemId) as {n:number}).n,1);
  db.close();
});

test("receiving an automatic suggestion materializes a completed purchase", () => {
  const {db,homeId,itemId,locationId}=fixture();
  db.prepare("UPDATE items SET reorder_point=3 WHERE id=?").run(itemId);
  const received=receiveShopping(db,homeId,`auto:${itemId}`,{actualQuantity:3,idempotencyKey:"auto-purchase"});
  assert.match(received.shoppingItemId,/^[0-9a-f-]{36}$/i);
  const purchase=db.prepare("SELECT source,completed,item_id AS itemId,quantity FROM shopping_list WHERE id=?").get(received.shoppingItemId) as {source:string;completed:number;itemId:string;quantity:number};
  assert.equal(purchase.source,"automatic");
  assert.equal(purchase.completed,1);
  assert.equal(purchase.itemId,itemId);
  assert.equal(purchase.quantity,3);
  assert.equal((db.prepare("SELECT shopping_item_id AS shoppingItemId FROM stock_batches WHERE item_id=?").get(itemId) as {shoppingItemId:string}).shoppingItemId,received.shoppingItemId);
  db.close();
});

test("shopping plans validate channels and materialize automatic suggestions",()=>{
  const {db,homeId,itemId}=fixture();
  seedShoppingChannels(db,homeId);
  const channelId=db.prepare("SELECT id FROM shopping_channels WHERE home_id=? AND name='京东'").get(homeId)?.id as string;
  db.prepare("UPDATE items SET reorder_point=3 WHERE id=?").run(itemId);
  const planned=saveShopping(db,homeId,{channelId,plannedDate:"2026-10-08"},`auto:${itemId}`);
  assert.equal(planned.itemId,itemId);
  assert.equal(planned.channelName,"京东");
  assert.equal(planned.plannedDate,"2026-10-08");
  assert.equal(planned.id.startsWith("auto:"),false);
  assert.equal(planned.source,"automatic");
  assert.equal(saveShopping(db,homeId,{plannedDate:"2026-10-09"},planned.id).source,"automatic","editing a persisted recommendation retains its automatic source");
  const otherHome=randomUUID(),otherChannel=randomUUID();
  db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(otherHome,"其他家");
  db.prepare("INSERT INTO shopping_channels(id,home_id,name) VALUES (?,?,?)").run(otherChannel,otherHome,"其他渠道");
  assert.throws(()=>saveShopping(db,homeId,{itemId,channelId:otherChannel}),/购买渠道/);
  db.close();
});

test("overview returns actionable stock, expiry, and shopping state", () => {
  const {db,homeId,locationId,itemId} = fixture();
  db.prepare("UPDATE items SET reorder_point=5 WHERE id=?").run(itemId);
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:2,idempotencyKey:"overview-stock",expiryDate:"2020-01-01"});
  saveShopping(db,homeId,{itemId,quantity:3});
  const overview=getHomeOverview(db,homeId,{expiryDays:"30",limit:"10"});
  assert.equal(overview.needsReplenishment.total,1);
  assert.equal(overview.expired.total,1);
  assert.equal(overview.shopping.total,1,"a persisted purchase suppresses its duplicate automatic recommendation");
  assert.equal(overview.recommendedActions[0].type,"handle_expired");
  assert.equal(overview.recommendedActions[0].message,"牛奶 批次已于 2020-01-01 过期");
  assert.equal(overview.recommendedActions.some(action=>action.type==="buy_pending"),true);
  db.close();
});

test("physical reconciliation records shortages by FEFO and gains as a new batch", () => {
  const {db,homeId,locationId,itemId} = fixture();
  recordStock(db,homeId,"receipt",{itemId,locationId,quantity:10,idempotencyKey:"opening",expiryDate:"2027-01-01"});
  const shortage={itemId,locationId,countedQuantity:7,idempotencyKey:"count-short"};
  const first=reconcileStock(db,homeId,shortage);
  assert.equal(first.difference,-3);
  assert.equal(first.action,"issue");
  assert.deepEqual(reconcileStock(db,homeId,shortage),first);
  const gain=reconcileStock(db,homeId,{itemId,locationId,countedQuantity:12,idempotencyKey:"count-gain",manufacturedDate:"2026-09-01",expiryDate:"2027-09-01"});
  assert.equal(gain.difference,5);
  assert.equal(gain.action,"receipt");
  assert.equal(gain.transactions.length,1);
  const unchanged=reconcileStock(db,homeId,{itemId,locationId,countedQuantity:12,idempotencyKey:"count-same"});
  assert.equal(unchanged.action,"none");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM stock_transactions WHERE item_id=?").get(itemId) as {n:number}).n,3);
  db.close();
});
