import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { InventoryError } from "./stock.js";

const monthSchema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export function financialSummary(db:DatabaseSync,homeId:string,raw:unknown) {
  const {month}=z.object({month:monthSchema}).strict().parse(raw);
  const home=db.prepare("SELECT default_currency AS currency FROM homes WHERE id=? AND active=1").get(homeId) as {currency:string}|undefined;
  if(!home)throw new InventoryError(404,"HOME_NOT_FOUND","error.homeNotFound");
  const spending=(db.prepare("SELECT COALESCE(SUM(purchase_total_minor),0) AS total FROM stock_batches WHERE home_id=? AND substr(purchased_date,1,7)=? AND purchase_total_minor IS NOT NULL").get(homeId,month) as {total:number}).total;
  const estimated=(db.prepare("SELECT COALESCE(SUM(estimated_total_minor),0) AS total FROM shopping_list WHERE home_id=? AND substr(planned_date,1,7)=? AND estimated_total_minor IS NOT NULL").get(homeId,month) as {total:number}).total;
  const byChannel=(db.prepare("SELECT b.channel_id AS channelId,c.name AS channelName,SUM(b.purchase_total_minor)/100.0 AS total FROM stock_batches b LEFT JOIN shopping_channels c ON c.id=b.channel_id WHERE b.home_id=? AND substr(b.purchased_date,1,7)=? AND b.purchase_total_minor IS NOT NULL GROUP BY b.channel_id,c.name ORDER BY total DESC").all(homeId,month));
  const batches=db.prepare(`SELECT b.id,b.purchase_total_minor AS totalMinor,
    COALESCE((SELECT SUM(CASE WHEN t.type='receipt' THEN t.quantity ELSE -t.quantity END) FROM stock_transactions t WHERE t.batch_id=b.id),0) AS remaining,
    COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.batch_id=b.id AND t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%'),0) AS initial
    FROM stock_batches b WHERE b.home_id=?`).all(homeId) as {id:string;totalMinor:number|null;remaining:number;initial:number}[];
  let valueMinor=0,pricedBatchCount=0,unknownBatchCount=0;
  for(const batch of batches)if(batch.remaining>1e-9) {
    if(batch.totalMinor==null||batch.initial<=0)unknownBatchCount++;
    else {valueMinor+=batch.totalMinor*batch.remaining/batch.initial;pricedBatchCount++;}
  }
  return {month,currency:home.currency,spendingTotal:spending/100,estimatedTotal:estimated/100,variance:(spending-estimated)/100,inventoryValue:Math.round(valueMinor)/100,pricedBatchCount,unknownBatchCount,byChannel};
}

export function itemPriceHistory(db:DatabaseSync,homeId:string,itemId:string) {
  if(!db.prepare("SELECT 1 FROM items WHERE id=? AND home_id=? AND active=1").get(itemId,homeId))
    throw new InventoryError(404,"ITEM_NOT_FOUND","error.itemNotFoundOrDeleted");
  const items=db.prepare(`SELECT b.id AS batchId,b.purchased_date AS purchaseDate,b.channel_id AS channelId,c.name AS channelName,
    b.purchase_currency AS currency,b.purchase_total_minor/100.0 AS totalPrice,
    COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.batch_id=b.id AND t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%'),0) AS quantity
    FROM stock_batches b LEFT JOIN shopping_channels c ON c.id=b.channel_id
    WHERE b.home_id=? AND b.item_id=? AND b.purchase_total_minor IS NOT NULL ORDER BY b.purchased_date DESC,b.received_at DESC`).all(homeId,itemId) as {batchId:string;purchaseDate:string|null;channelId:string|null;channelName:string|null;currency:string;totalPrice:number;quantity:number}[];
  return {itemId,items:items.map(item=>({...item,unitPrice:item.quantity>0?Math.round(item.totalPrice/item.quantity*100)/100:null}))};
}
