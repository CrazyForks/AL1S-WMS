import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { renderTranslation, type Locale, type TranslationKey } from "./i18n/index.js";

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
export const stockInput = z.object({ itemId:z.string().uuid(),locationId:z.string().uuid(),quantity:z.number().positive().finite(),idempotencyKey:z.string().trim().min(1).max(200),reason:z.string().max(200).optional(),issueReason:issueReasonSchema.optional(),batchId:z.string().uuid().optional(),...batchDates }).strict();
export const transferInput = stockInput.omit({locationId:true,manufacturedDate:true,expiryDate:true,issueReason:true}).extend({sourceLocationId:z.string().uuid(),targetLocationId:z.string().uuid()});
export const reconcileInput = z.object({itemId:z.string().uuid(),locationId:z.string().uuid(),countedQuantity:z.number().nonnegative().finite(),idempotencyKey:z.string().trim().min(1).max(200),reason:z.string().max(200).optional(),batchId:z.string().uuid().optional(),...batchDates}).strict();
export const batchBalanceQuery = `SELECT b.id AS batchId,b.home_id AS homeId,b.item_id AS itemId,i.name AS itemName,i.base_unit AS baseUnit,b.label,b.manufactured_date AS manufacturedDate,b.expiry_date AS expiryDate,b.received_at AS receivedAt,b.legacy,t.location_id AS locationId,l.name AS locationName,
  COALESCE(SUM(CASE WHEN t.type='receipt' THEN t.quantity ELSE -t.quantity END),0) AS quantity
  FROM stock_batches b JOIN items i ON i.id=b.item_id LEFT JOIN stock_transactions t ON t.batch_id=b.id AND t.home_id=b.home_id
  LEFT JOIN locations l ON l.id=t.location_id GROUP BY b.id,t.location_id`;
export type BatchBalance = {batchId:string;itemId:string;locationId:string;quantity:number;expiryDate:string|null;manufacturedDate:string|null};
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
  return (db.prepare("SELECT COALESCE(SUM(CASE WHEN type='receipt' THEN quantity ELSE -quantity END),0) AS quantity FROM stock_transactions WHERE home_id=? AND item_id=? AND location_id=?").get(homeId,itemId,locationId) as {quantity:number}).quantity;
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
export function withStockOperation<T>(db:DatabaseSync,homeId:string,key:string,payload:unknown,fn:()=>T):T {
  return atomic(db,()=>{
    const serialized=JSON.stringify(payload);
    const previous=db.prepare("SELECT payload,response FROM stock_operations WHERE home_id=? AND idempotency_key=?").get(homeId,key) as {payload:string;response:string}|undefined;
    if(previous) { if(previous.payload!==serialized) throw new InventoryError(409,"IDEMPOTENCY_CONFLICT","error.idempotencyConflict");return JSON.parse(previous.response) as T; }
    const result=fn();
    db.prepare("INSERT INTO stock_operations(home_id,idempotency_key,payload,response) VALUES (?,?,?,?)").run(homeId,key,serialized,JSON.stringify(result));
    return result;
  });
}
export function recordStock(db:DatabaseSync,homeId:string,type:"receipt"|"issue",raw:unknown) {
  const input=stockInput.parse(raw);
  const {itemId,locationId,quantity,idempotencyKey,reason}=input;
  const issueReason:IssueReason|null=type==="issue"?input.issueReason??"used":null;
  return withStockOperation(db,homeId,idempotencyKey,{type,...input},()=>{
    requireStockTarget(db,homeId,itemId,locationId);
    const beforeQuantity=stockAt(db,homeId,itemId,locationId);
    validateDates(input.manufacturedDate,input.expiryDate);
    if(type==="receipt" && input.batchId) throw new InventoryError(400,"NEW_BATCH_REQUIRED","error.receiptExistingBatch");
    if(type==="issue" && (input.manufacturedDate!==undefined||input.expiryDate!==undefined)) throw new InventoryError(400,"INVALID_FIELDS","error.issueBatchDates");
    let parts:{batchId:string;quantity:number}[];
    if(type==="receipt") {
      const batchId=randomUUID();
      db.prepare("INSERT INTO stock_batches(id,home_id,item_id,manufactured_date,expiry_date,received_at) VALUES (?,?,?,?,?,?)").run(batchId,homeId,itemId,input.manufacturedDate??null,input.expiryDate??null,new Date().toISOString());
      parts=[{batchId,quantity}];
    } else parts=allocate(db,homeId,itemId,locationId,quantity,input.batchId);
    const defaultReason = type === "receipt"
      ? ["入库新批次", input.manufacturedDate&&`生产 ${input.manufacturedDate}`, input.expiryDate&&`到期 ${input.expiryDate}`].filter(Boolean).join(" · ")
      : input.batchId ? "领用指定批次" : "按到期顺序领用";
    const transactions=parts.map((part,index)=>({id:ledgerEntry(db,homeId,itemId,locationId,part.batchId,type,part.quantity,`${idempotencyKey}:${index}`,reason||defaultReason,issueReason),issueReason,...part}));
    refreshItemDates(db,homeId,itemId);
    const afterQuantity=stockAt(db,homeId,itemId,locationId);
    return {homeId,itemId,locationId,type,quantity,issueReason,beforeQuantity,afterQuantity,difference:afterQuantity-beforeQuantity,transactions};
  });
}
export function transferStock(db:DatabaseSync,homeId:string,raw:unknown) {
  const input=transferInput.parse(raw);
  const {itemId,sourceLocationId,targetLocationId,quantity,idempotencyKey,batchId}=input;
  return withStockOperation(db,homeId,idempotencyKey,{type:"transfer",...input},()=>{
    requireStockTarget(db,homeId,itemId,sourceLocationId); requireStockTarget(db,homeId,itemId,targetLocationId);
    if(sourceLocationId===targetLocationId) throw new InventoryError(400,"SAME_LOCATION","error.sameLocation");
    const sourceBefore=stockAt(db,homeId,itemId,sourceLocationId),targetBefore=stockAt(db,homeId,itemId,targetLocationId);
    const parts=allocate(db,homeId,itemId,sourceLocationId,quantity,batchId);
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
    const difference=input.countedQuantity-beforeQuantity;
    if(Math.abs(difference)<1e-9)return {homeId,itemId:input.itemId,locationId:input.locationId,beforeQuantity,afterQuantity:beforeQuantity,difference:0,action:"none",transactions:[]};
    if(difference>0&&input.batchId)throw new InventoryError(400,"NEW_BATCH_REQUIRED","error.reconcileGainBatch");
    if(difference<0&&(input.manufacturedDate!==undefined||input.expiryDate!==undefined))throw new InventoryError(400,"INVALID_FIELDS","error.reconcileLossDates");
    const action=difference>0?"receipt":"issue";
    const result=recordStock(db,homeId,action,{
      itemId:input.itemId,locationId:input.locationId,quantity:Math.abs(difference),
      idempotencyKey:`reconcile:${input.idempotencyKey}`,
      reason:input.reason||(difference>0?"盘点盘盈":"盘点盘亏"),
      ...(difference>0?{manufacturedDate:input.manufacturedDate,expiryDate:input.expiryDate}:{batchId:input.batchId,issueReason:"adjustment"}),
    });
    return {homeId,itemId:input.itemId,locationId:input.locationId,beforeQuantity,afterQuantity:result.afterQuantity,difference,action,transactions:result.transactions};
  });
}
