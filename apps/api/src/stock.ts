import {startWorkflow,finishWorkflow,endWorkflow} from "./workflows.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { renderTranslation, type Locale, type TranslationKey } from "./i18n/index.js";
import { nonnegativeQuantity, positiveQuantity, roundQuantity } from "./quantity.js";

export class InventoryError extends Error {
  constructor(
    public status: number,
    public code: string,
    public messageKey: TranslationKey,
    public messageParams?: Record<string, unknown>,
  ) {
    super(renderTranslation("zh-CN", messageKey, messageParams));
  }
  localized(locale: Locale) {
    return renderTranslation(locale, this.messageKey, this.messageParams);
  }
}
export const batchDates = { manufacturedDate: z.string().date().nullable().optional(), expiryDate: z.string().date().nullable().optional() };
export const issueReasonSchema=z.enum(["used","expired","damaged","adjustment"]);
export type IssueReason=z.infer<typeof issueReasonSchema>;
export const moneySchema=z.number().nonnegative().finite().max(1_000_000_000);
export const stockInput = z.object({ itemId:z.string().uuid(),locationId:z.string().uuid(),targetLocationId:z.string().uuid().optional(),quantity:positiveQuantity,idempotencyKey:z.string().trim().min(1).max(200),reason:z.string().max(200).optional(),issueReason:issueReasonSchema.optional(),batchId:z.string().uuid().optional(),totalPrice:moneySchema.optional(),purchaseDate:z.string().date().nullable().optional(),channelId:z.string().uuid().nullable().optional(),shoppingItemId:z.string().max(80).nullable().optional(),...batchDates }).strict();
export const transferInput = stockInput.omit({targetLocationId:true,locationId:true,manufacturedDate:true,expiryDate:true,issueReason:true,totalPrice:true,purchaseDate:true,channelId:true,shoppingItemId:true}).extend({sourceLocationId:z.string().uuid(),targetLocationId:z.string().uuid(),openedId:z.string().uuid().optional()});
export const reconcileInput = z.object({itemId:z.string().uuid(),locationId:z.string().uuid(),countedQuantity:nonnegativeQuantity,idempotencyKey:z.string().trim().min(1).max(200),reason:z.string().max(200).optional(),batchId:z.string().uuid().optional(),...batchDates}).strict();
export const batchBalanceQuery = `SELECT b.id AS batchId,b.home_id AS homeId,b.item_id AS itemId,i.name AS itemName,i.category AS itemCategory,i.base_unit AS baseUnit,b.label,b.manufactured_date AS manufacturedDate,b.expiry_date AS expiryDate,b.received_at AS receivedAt,b.legacy,b.purchase_total_minor AS purchaseTotalMinor,b.purchase_currency AS purchaseCurrency,b.purchased_date AS purchasedDate,b.channel_id AS channelId,c.name AS channelName,b.shopping_item_id AS shoppingItemId,b.purchase_category AS purchaseCategory,
  COALESCE((SELECT SUM(origin.quantity) FROM stock_transactions origin WHERE origin.batch_id=b.id AND origin.type='receipt' AND origin.idempotency_key NOT LIKE 'event:%'),0) AS initialQuantity,t.location_id AS locationId,l.name AS locationName,
  ROUND(COALESCE(SUM(CASE WHEN t.type='receipt' THEN t.quantity ELSE -t.quantity END),0),2) AS quantity
  FROM stock_batches b JOIN items i ON i.id=b.item_id LEFT JOIN stock_transactions t ON t.batch_id=b.id AND t.home_id=b.home_id
  LEFT JOIN locations l ON l.id=t.location_id LEFT JOIN shopping_channels c ON c.id=b.channel_id GROUP BY b.id,t.location_id`;
export type BatchBalance = {batchId:string;itemId:string;locationId:string;quantity:number;expiryDate:string|null;manufacturedDate:string|null;purchaseTotalMinor:number|null;purchaseCurrency:string|null;purchasedDate:string|null;channelId:string|null;channelName:string|null;initialQuantity:number};
export type OpenedConsumable = {id:string;itemId:string;itemName:string;baseUnit:string;locationId:string;locationName:string;batchId:string;batchLabel:string|null;manufacturedDate:string|null;expiryDate:string|null;openedExpiryDate:string|null;quantity:number;openedAt:string};
export function atomic<T>(db:DatabaseSync, fn:()=>T):T {
  const key = `sp_${randomUUID().replaceAll("-","")}`;
  db.exec(`SAVEPOINT ${key}`);
  try { const result=fn(); db.exec(`RELEASE ${key}`); return result; }
  catch(error) { db.exec(`ROLLBACK TO ${key}; RELEASE ${key}`); throw error; }
}
export function validateDates(manufactured?:string|null, expiry?:string|null) {
  if(manufactured && expiry && expiry < manufactured) throw new InventoryError(400,"INVALID_DATES","error.invalidDates");
}
export function requireStockTarget(db:DatabaseSync,homeId:string,itemId:string,locationId?:string) {
  if(!db.prepare("SELECT 1 FROM items WHERE id=? AND home_id=? AND active=1").get(itemId,homeId)) throw new InventoryError(404,"ITEM_NOT_FOUND","error.itemNotFoundOrDeleted");
  if(locationId && !db.prepare("SELECT 1 FROM locations WHERE id=? AND home_id=? AND active=1").get(locationId,homeId)) throw new InventoryError(404,"LOCATION_NOT_FOUND","error.locationNotInHome");
}
export function stockAt(db:DatabaseSync,homeId:string,itemId:string,locationId:string) {
  return roundQuantity((db.prepare("SELECT COALESCE(SUM(CASE WHEN type='receipt' THEN quantity ELSE -quantity END),0) AS quantity FROM stock_transactions WHERE home_id=? AND item_id=? AND location_id=?").get(homeId,itemId,locationId) as {quantity:number}).quantity);
}
export function recordItemEvent(db:DatabaseSync, homeId:string,itemId:string,type:"delete"|"reclassify"|"move"|"update",reason:string, locationId:string|null=null,quantity:number|null=null,batchId:string|null=null) {
  const item=db.prepare("SELECT name FROM items WHERE id=? AND home_id=?").get(itemId,homeId) as {name:string};
  const location=locationId ? db.prepare("SELECT name FROM locations WHERE id=? AND home_id=?").get(locationId,homeId) as {name:string}|undefined : undefined;
  const id=randomUUID();
  db.prepare("INSERT INTO item_events(id,home_id,item_id,item_name,location_id,location_name,type,quantity,reason,occurred_at,batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id,homeId,itemId,item.name,locationId,location?.name??null,type,quantity,reason,new Date().toISOString(),batchId);
  return id;
}
export function ledgerEntry(db:DatabaseSync,homeId:string,itemId:string,locationId:string,batchId:string,type:"receipt"|"issue",quantity:number,key:string,reason:string,issueReason:IssueReason|null=null) {
  const id=randomUUID();
  db.prepare("INSERT INTO stock_transactions(id,home_id,item_id,location_id,batch_id,type,quantity,idempotency_key,reason,issue_reason,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id,homeId,itemId,locationId,batchId,type,quantity,key,reason,issueReason,new Date().toISOString());
  return id;
}
export function refreshItemDates(db:DatabaseSync,homeId:string,itemId:string) {
  const next=db.prepare(`SELECT manufacturedDate,expiryDate FROM (${batchBalanceQuery}) WHERE homeId=? AND itemId=? AND quantity>0 ORDER BY expiryDate IS NULL,expiryDate,receivedAt,batchId LIMIT 1`).get(homeId,itemId) as {manufacturedDate:string|null;expiryDate:string|null}|undefined;
  db.prepare("UPDATE items SET manufactured_date=?,expiry_date=? WHERE home_id=? AND id=?").run(next?.manufacturedDate??null,next?.expiryDate??null,homeId,itemId);
}
export function allocate(db:DatabaseSync,homeId:string,itemId:string,locationId:string,quantity:number,batchId?:string) {
  const rows=db.prepare(`SELECT * FROM (${batchBalanceQuery}) WHERE homeId=? AND itemId=? AND locationId=? AND quantity>0 ${batchId?"AND batchId=?":""} ORDER BY expiryDate IS NULL,expiryDate,receivedAt,batchId`).all(...[homeId,itemId,locationId,...(batchId?[batchId]:[])]) as BatchBalance[];
  const available=rows.reduce((sum,row)=>sum+row.quantity,0);
  if(available+1e-9 < quantity) throw new InventoryError(409,"INSUFFICIENT_STOCK",batchId?"error.insufficientBatchStock":"error.insufficientStock",{available});
  let remaining=quantity;
  const parts:{batchId:string;quantity:number}[]=[];
  for(const row of rows) { const used=Math.min(row.quantity,remaining); if(used>1e-9) parts.push({batchId:row.batchId,quantity:used});remaining-=used; }
  return parts;
}
function allocateUnopened(db:DatabaseSync,homeId:string,itemId:string,locationId:string,quantity:number,batchId?:string) {
  const rows=db.prepare(`SELECT * FROM (${batchBalanceQuery}) WHERE homeId=? AND itemId=? AND locationId=? AND quantity>0 ${batchId?"AND batchId=?":""} ORDER BY expiryDate IS NULL,expiryDate,receivedAt,batchId`).all(...[homeId,itemId,locationId,...(batchId?[batchId]:[])]) as BatchBalance[];
  const opened=db.prepare("SELECT batch_id AS batchId,COALESCE(SUM(quantity),0) AS quantity FROM opened_consumables WHERE home_id=? AND item_id=? AND location_id=? GROUP BY batch_id").all(homeId,itemId,locationId) as {batchId:string;quantity:number}[];
  const openedByBatch=new Map(opened.map(row=>[row.batchId,row.quantity]));
  const available=rows.reduce((sum,row)=>sum+Math.max(0,row.quantity-(openedByBatch.get(row.batchId)??0)),0);
  if(available+1e-9<quantity)throw new InventoryError(409,"INSUFFICIENT_UNOPENED_STOCK","error.insufficientUnopenedStock",{available});
  let remaining=quantity; const parts:{batchId:string;quantity:number}[]=[];
  for(const row of rows) { const usable=Math.max(0,row.quantity-(openedByBatch.get(row.batchId)??0)); const used=Math.min(usable,remaining); if(used>1e-9)parts.push({batchId:row.batchId,quantity:used}); remaining-=used; }
  return parts;
}
export function listOpenedConsumables(db:DatabaseSync,homeId:string):OpenedConsumable[] {
  return db.prepare(`SELECT o.id,o.item_id AS itemId,i.name AS itemName,i.base_unit AS baseUnit,o.location_id AS locationId,l.name AS locationName,o.batch_id AS batchId,b.label AS batchLabel,b.manufactured_date AS manufacturedDate,b.expiry_date AS expiryDate,o.opened_expiry_date AS openedExpiryDate,o.quantity,o.opened_at AS openedAt FROM opened_consumables o JOIN items i ON i.id=o.item_id JOIN stock_batches b ON b.id=o.batch_id LEFT JOIN locations l ON l.id=o.location_id WHERE o.home_id=? ORDER BY o.opened_at DESC,o.id DESC`).all(homeId) as OpenedConsumable[];
}
export function exhaustOpenedConsumable(db:DatabaseSync,homeId:string,raw:unknown) {
  const input=z.object({id:z.string().uuid(),quantity:positiveQuantity.optional(),idempotencyKey:z.string().trim().min(1).max(200),reason:z.string().max(200).optional()}).strict().parse(raw);
  return withStockOperation(db,homeId,input.idempotencyKey,{type:"exhaust-opened",...input},()=>{
    const opened=db.prepare("SELECT * FROM opened_consumables WHERE id=? AND home_id=?").get(input.id,homeId) as {id:string;item_id:string;location_id:string;batch_id:string;quantity:number}|undefined;
    if(!opened)throw new InventoryError(404,"OPENED_CONSUMABLE_NOT_FOUND","error.openedConsumableNotFound");
    const quantity=input.quantity??roundQuantity(opened.quantity);
    if(quantity>opened.quantity+1e-9)throw new InventoryError(409,"OPENED_CONSUMABLE_QUANTITY","error.openedConsumableQuantity");
    const result=recordStock(db,homeId,"issue",{itemId:opened.item_id,locationId:opened.location_id,batchId:opened.batch_id,quantity,idempotencyKey:`opened-exhaust:${input.idempotencyKey}`,reason:input.reason,issueReason:"used",forceDirectIssue:true});
    if(Math.abs(quantity-opened.quantity)<1e-9)db.prepare("DELETE FROM opened_consumables WHERE id=?").run(opened.id);
    else db.prepare("UPDATE opened_consumables SET quantity=ROUND(quantity-?,2) WHERE id=?").run(quantity,opened.id);
    return {...result,openedId:opened.id,action:"exhausted"};
  });
}
export function withStockOperation<T>(db:DatabaseSync,homeId:string,key:string,payload:unknown,fn:()=>T):T {
  return atomic(db,()=>{
    const serialized=JSON.stringify(payload);
    const previous=db.prepare("SELECT payload,response FROM stock_operations WHERE home_id=? AND idempotency_key=?").get(homeId,key) as {payload:string;response:string}|undefined;
    if(previous) { if(previous.payload!==serialized) throw new InventoryError(409,"IDEMPOTENCY_CONFLICT","error.idempotencyConflict");return JSON.parse(previous.response) as T; }
    const snapshot=startWorkflow(db,homeId);
    try {
      const result=fn();
      if(snapshot)finishWorkflow(db,homeId,key,payload,snapshot);
      db.prepare("INSERT INTO stock_operations(home_id,idempotency_key,payload,response) VALUES (?,?,?,?)").run(homeId,key,serialized,JSON.stringify(result));
      return result;
    } finally {if(snapshot)endWorkflow(db); }
  });
}
export function recordStock(db:DatabaseSync,homeId:string,type:"receipt"|"issue",raw:unknown) {
  const {forceDirectIssue=false,...inputRaw}=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;
  const input=stockInput.parse(inputRaw);
  const {itemId,locationId,quantity,idempotencyKey,reason}=input;
  const issueReason:IssueReason|null=type==="issue"?input.issueReason??"used":null;
  return withStockOperation(db,homeId,idempotencyKey,{type,...input},()=>{
    requireStockTarget(db,homeId,itemId,locationId);
    const beforeQuantity=stockAt(db,homeId,itemId,locationId);
    validateDates(input.manufacturedDate,input.expiryDate);
    if(type==="receipt" && input.targetLocationId)throw new InventoryError(400,"INVALID_FIELDS","error.validation");
    if(type==="receipt" && input.batchId) throw new InventoryError(400,"NEW_BATCH_REQUIRED","error.receiptExistingBatch");
    if(type==="issue" && (input.manufacturedDate!==undefined||input.expiryDate!==undefined)) throw new InventoryError(400,"INVALID_FIELDS","error.issueBatchDates");
    let parts:{batchId:string;quantity:number}[];
    let recordedPurchaseDate=input.purchaseDate??null;
    if(type==="receipt") {
      const batchId=randomUUID();
      if(input.channelId&&!db.prepare("SELECT 1 FROM shopping_channels WHERE id=? AND home_id=? AND active=1").get(input.channelId,homeId))throw new InventoryError(400,"SHOPPING_CHANNEL_NOT_FOUND","error.shoppingChannelNotFound");
      const currency=(db.prepare("SELECT default_currency AS currency FROM homes WHERE id=?").get(homeId) as {currency:string}).currency;
      recordedPurchaseDate??=input.totalPrice!==undefined||input.channelId?new Date().toISOString().slice(0,10):null;
      const purchaseCategory=(db.prepare("SELECT category FROM items WHERE id=? AND home_id=?").get(itemId,homeId) as {category:string}).category;
      db.prepare("INSERT INTO stock_batches(id,home_id,item_id,manufactured_date,expiry_date,received_at,purchase_total_minor,purchase_currency,purchased_date,channel_id,shopping_item_id,purchase_category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(batchId,homeId,itemId,input.manufacturedDate??null,input.expiryDate??null,new Date().toISOString(),input.totalPrice===undefined?null:Math.round(input.totalPrice*100),input.totalPrice===undefined?null:currency,recordedPurchaseDate,input.channelId??null,input.shoppingItemId??null,purchaseCategory);
      parts=[{batchId,quantity}];
    } else {
      const item=db.prepare("SELECT consumption_type AS consumptionType,opened_shelf_life_days AS openedShelfLifeDays FROM items WHERE id=? AND home_id=?").get(itemId,homeId) as {consumptionType:"non_consumable"|"consumable"|"long_term_consumable";openedShelfLifeDays:number|null};
      if(item.consumptionType==="long_term_consumable" && !forceDirectIssue) {
        const useLocation=input.targetLocationId??locationId;
        requireStockTarget(db,homeId,itemId,useLocation);
        parts=allocateUnopened(db,homeId,itemId,locationId,quantity,input.batchId);
        if(useLocation!==locationId)transferStock(db,homeId,{itemId,sourceLocationId:locationId,targetLocationId:useLocation,quantity,batchId:input.batchId,idempotencyKey:`opening-move:${idempotencyKey}`});
        const openedAt=new Date().toISOString();
        const expiryByBatch=new Map((db.prepare(`SELECT batchId,expiryDate FROM (${batchBalanceQuery}) WHERE homeId=? AND itemId=? AND locationId=?`).all(homeId,itemId,locationId) as {batchId:string;expiryDate:string|null}[]).map(row=>[row.batchId,row.expiryDate]));
        const calculatedExpiry=item.openedShelfLifeDays===null?null:new Date(Date.now()+item.openedShelfLifeDays*86400000).toISOString().slice(0,10);
        const opened=parts.map(part=>({id:randomUUID(),...part,quantity:part.quantity,openedAt,openedExpiryDate:calculatedExpiry&&expiryByBatch.get(part.batchId)?(calculatedExpiry<expiryByBatch.get(part.batchId)!?calculatedExpiry:expiryByBatch.get(part.batchId)!):calculatedExpiry}));
        for(const part of opened) db.prepare("INSERT INTO opened_consumables(id,home_id,item_id,location_id,batch_id,quantity,opened_at,opened_expiry_date) VALUES (?,?,?,?,?,?,?,?)").run(part.id,homeId,itemId,useLocation,part.batchId,part.quantity,openedAt,part.openedExpiryDate);
        for(const part of opened) recordItemEvent(db,homeId,itemId,"update","reason.openLongTermConsumable",useLocation,part.quantity,part.batchId);
        return {homeId,itemId,locationId,type,quantity,issueReason,totalPrice:null,purchaseDate:null,channelId:null,beforeQuantity,afterQuantity:stockAt(db,homeId,itemId,locationId),difference:roundQuantity(stockAt(db,homeId,itemId,locationId)-beforeQuantity),targetLocationId:useLocation,action:"opened",opened,transactions:[]};
      }
      if(input.targetLocationId)throw new InventoryError(400,"INVALID_FIELDS","error.validation");
      parts=item.consumptionType==="long_term_consumable"&&issueReason==="adjustment"?allocateUnopened(db,homeId,itemId,locationId,quantity,input.batchId):allocate(db,homeId,itemId,locationId,quantity,input.batchId);
    }
    const defaultReason = type === "receipt"
      ? "reason.newBatch"
      : input.batchId ? "reason.specifiedBatchIssue" : "reason.fefoIssue";
    const transactions=parts.map((part,index)=>({id:ledgerEntry(db,homeId,itemId,locationId,part.batchId,type,part.quantity,`${idempotencyKey}:${index}`,reason||defaultReason,issueReason),issueReason,...part}));
    refreshItemDates(db,homeId,itemId);
    const afterQuantity=stockAt(db,homeId,itemId,locationId);
    return {homeId,itemId,locationId,type,quantity,issueReason,totalPrice:input.totalPrice??null,purchaseDate:recordedPurchaseDate,channelId:input.channelId??null,beforeQuantity,afterQuantity,difference:afterQuantity-beforeQuantity,transactions};
  });
}
export function transferStock(db:DatabaseSync,homeId:string,raw:unknown) {
  const input=transferInput.parse(raw);
  const {itemId,sourceLocationId,targetLocationId,quantity,idempotencyKey,batchId}=input;
  return withStockOperation(db,homeId,idempotencyKey,{type:"transfer",...input},()=>{
    requireStockTarget(db,homeId,itemId,sourceLocationId); requireStockTarget(db,homeId,itemId,targetLocationId);
    if(sourceLocationId===targetLocationId) throw new InventoryError(400,"SAME_LOCATION","error.sameLocation");
    const sourceBefore=stockAt(db,homeId,itemId,sourceLocationId),targetBefore=stockAt(db,homeId,itemId,targetLocationId);
    const item=db.prepare("SELECT consumption_type AS consumptionType FROM items WHERE id=? AND home_id=?").get(itemId,homeId) as {consumptionType:"non_consumable"|"consumable"|"long_term_consumable"};
    const opened=input.openedId?db.prepare("SELECT * FROM opened_consumables WHERE id=? AND home_id=? AND item_id=? AND location_id=?").get(input.openedId,homeId,itemId,sourceLocationId) as {id:string;batch_id:string;quantity:number;opened_at:string;opened_expiry_date:string|null}|undefined:undefined;
    if(input.openedId&&(!opened||quantity>opened.quantity||batchId&&batchId!==opened.batch_id))throw new InventoryError(409,"OPENED_CONSUMABLE_QUANTITY","error.openedConsumableQuantity");
    const parts=opened?allocate(db,homeId,itemId,sourceLocationId,quantity,opened.batch_id):item.consumptionType==="long_term_consumable"?allocateUnopened(db,homeId,itemId,sourceLocationId,quantity,batchId):allocate(db,homeId,itemId,sourceLocationId,quantity,batchId);
    if(opened){
      if(quantity===opened.quantity)db.prepare("UPDATE opened_consumables SET location_id=? WHERE id=? AND home_id=?").run(targetLocationId,opened.id,homeId);
      else {
        db.prepare("UPDATE opened_consumables SET quantity=ROUND(quantity-?,2) WHERE id=? AND home_id=?").run(quantity,opened.id,homeId);
        db.prepare("INSERT INTO opened_consumables(id,home_id,item_id,location_id,batch_id,quantity,opened_at,opened_expiry_date) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(),homeId,itemId,targetLocationId,opened.batch_id,quantity,opened.opened_at,opened.opened_expiry_date);
      }
    }
    const source=db.prepare("SELECT name FROM locations WHERE id=?").get(sourceLocationId) as {name:string};
    const target=db.prepare("SELECT name FROM locations WHERE id=?").get(targetLocationId) as {name:string};
    const reason=input.reason||`库存调拨：${source.name} → ${target.name}`;
    const eventId=recordItemEvent(db,homeId,itemId,"move",reason,targetLocationId,quantity,batchId??null);
    for(const [index,part] of parts.entries()) {
      ledgerEntry(db,homeId,itemId,sourceLocationId,part.batchId,"issue",part.quantity,`event:${eventId}:${index}:out`,reason);
      ledgerEntry(db,homeId,itemId,targetLocationId,part.batchId,"receipt",part.quantity,`event:${eventId}:${index}:in`,reason);
    }
    return {homeId,itemId,sourceLocationId,targetLocationId,quantity,sourceBefore,sourceAfter:stockAt(db,homeId,itemId,sourceLocationId),targetBefore,targetAfter:stockAt(db,homeId,itemId,targetLocationId),batches:parts};
  });
}

export function reconcileStock(db:DatabaseSync,homeId:string,raw:unknown) {
  const input=reconcileInput.parse(raw);
  return withStockOperation(db,homeId,input.idempotencyKey,{type:"reconcile",...input},()=>{
    requireStockTarget(db,homeId,input.itemId,input.locationId);
    validateDates(input.manufacturedDate,input.expiryDate);
    const beforeQuantity=stockAt(db,homeId,input.itemId,input.locationId);
    const difference=roundQuantity(input.countedQuantity-beforeQuantity);
    if(Math.abs(difference)<1e-9)return {homeId,itemId:input.itemId,locationId:input.locationId,beforeQuantity,afterQuantity:beforeQuantity,difference:0,action:"none",transactions:[]};
    if(difference>0&&input.batchId)throw new InventoryError(400,"NEW_BATCH_REQUIRED","error.reconcileGainBatch");
    if(difference<0&&(input.manufacturedDate!==undefined||input.expiryDate!==undefined))throw new InventoryError(400,"INVALID_FIELDS","error.reconcileLossDates");
    const action=difference>0?"receipt":"issue";
    const result=recordStock(db,homeId,action,{
      itemId:input.itemId,locationId:input.locationId,quantity:Math.abs(difference),
      idempotencyKey:`reconcile:${input.idempotencyKey}`,
      reason:input.reason||(difference>0?"reason.stocktakeGain":"reason.stocktakeLoss"),
      ...(difference>0?{manufacturedDate:input.manufacturedDate,expiryDate:input.expiryDate}:{batchId:input.batchId,issueReason:"adjustment"}),
      ...(difference<0?{forceDirectIssue:true}:{}),
    });
    return {homeId,itemId:input.itemId,locationId:input.locationId,beforeQuantity,afterQuantity:result.afterQuantity,difference,action,transactions:result.transactions};
  });
}
