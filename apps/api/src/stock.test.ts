import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase } from "@family-erp/db";
import { listBatches, listItems } from "./queries.js";
import { receiveShopping, saveShopping } from "./shopping.js";
import { InventoryError, recordStock } from "./stock.js";

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

test("receipts create batches and issues allocate FEFO idempotently", () => {
  const {db,homeId,locationId,itemId} = fixture();
  const receive = (quantity:number, expiryDate:string|null, key:string) =>
    recordStock(db,homeId,"receipt",{itemId,locationId,quantity,expiryDate,idempotencyKey:key});
  const late = receive(5,"2027-06-01","late").transactions[0].batchId;
  const early = receive(3,"2027-01-01","early").transactions[0].batchId;
  const undated = receive(2,null,"undated").transactions[0].batchId;
  const issueInput = {itemId,locationId,quantity:6,idempotencyKey:"issue-fefo"};
  const issued = recordStock(db,homeId,"issue",issueInput);
  assert.deepEqual(issued.transactions.map(row=>[row.batchId,row.quantity]),[[early,3],[late,3]]);
  assert.deepEqual(recordStock(db,homeId,"issue",issueInput),issued);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM stock_transactions WHERE type='issue'").get() as {n:number}).n,2);
  const batches = listBatches(db,homeId,{itemId,includeEmpty:"true"}) as unknown as {items:{batchId:string;quantity:number}[]};
  assert.deepEqual(new Map(batches.items.map(row=>[row.batchId,row.quantity])),new Map([[early,0],[late,2],[undated,2]]));
  assert.throws(
    () => recordStock(db,homeId,"issue",{itemId,locationId,batchId:early,quantity:1,idempotencyKey:"empty-batch"}),
    (error:unknown) => error instanceof InventoryError && error.code === "INSUFFICIENT_STOCK",
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
