import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase, seedShoppingChannels } from "@al1s-wms/db";
import { financialSummary, itemPriceHistory } from "./pricing.js";
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
  const batch=db.prepare("SELECT purchase_total_minor AS total,channel_id AS channelId,purchased_date AS purchaseDate FROM stock_batches WHERE item_id=?").get(itemId);
  assert.equal(batch?.total,840);
  assert.equal(batch?.channelId,channelId);
  assert.equal(batch?.purchaseDate,"2026-09-20");
  const suggested=saveShopping(db,homeId,{itemId,quantity:2,channelId,plannedDate:"2026-10-01"});
  assert.equal(suggested.estimatedTotal,5.6);
  db.close();
});
