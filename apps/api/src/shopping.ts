import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { batchDates, InventoryError, recordStock, withStockOperation } from "./stock.js";

const fields = {itemId:z.string().uuid().nullable().optional(),name:z.string().trim().min(1).max(200).optional(),quantity:z.number().positive().finite().optional(),unit:z.string().trim().min(1).max(30).optional(),category:z.string().trim().min(1).max(100).optional(),locationId:z.string().uuid().nullable().optional(),channelId:z.string().uuid().nullable().optional(),plannedDate:z.string().date().nullable().optional()};
export const shoppingSchema=z.object(fields).strict();
type Purchase={id:string;itemId:string|null;name:string;quantity:number;unit:string|null;category:string|null;locationId:string|null;channelId:string|null;plannedDate:string|null;source?:string;completed:number};
export function saveShopping(db:DatabaseSync,homeId:string,raw:unknown,id?:string) {
  const input=shoppingSchema.parse(raw);
  const automaticId=id?.startsWith("auto:")?id.slice(5):null;
  const current=automaticId
    ? db.prepare("SELECT ? AS id,id AS itemId,name,MAX(reorder_point-(SELECT COALESCE(SUM(CASE WHEN type='receipt' THEN quantity ELSE -quantity END),0) FROM stock_transactions WHERE item_id=items.id),0) AS quantity,base_unit AS unit,category,default_location_id AS locationId,NULL AS channelId,NULL AS plannedDate,0 AS completed FROM items WHERE id=? AND home_id=? AND active=1").get(id!,automaticId,homeId) as Purchase|undefined
    : id?db.prepare("SELECT id,item_id AS itemId,name,quantity,unit,category,location_id AS locationId,channel_id AS channelId,planned_date AS plannedDate,source,completed FROM shopping_list WHERE id=? AND home_id=?").get(id,homeId) as Purchase|undefined:undefined;
  if(id&&!current)throw new InventoryError(404,"SHOPPING_ITEM_NOT_FOUND","error.shoppingItemNotFound");
  if(automaticId&&current!.quantity<=0)throw new InventoryError(409,"SHOPPING_SUGGESTION_RESOLVED","error.shoppingSuggestionResolved");
  if(current?.completed)throw new InventoryError(409,"SHOPPING_COMPLETED","error.shoppingCompletedEdit");
  const itemId=automaticId?current!.itemId:input.itemId===undefined?current?.itemId??null:input.itemId;
  const linked=itemId?db.prepare("SELECT name,base_unit AS unit,category,default_location_id AS locationId FROM items WHERE home_id=? AND id=? AND active=1").get(homeId,itemId) as Partial<Purchase>|undefined:undefined;
  if(itemId&&!linked)throw new InventoryError(404,"ITEM_NOT_FOUND","error.linkedItemNotFound");
  const result={...current,...input,...linked,id:id??randomUUID(),itemId,quantity:input.quantity??current?.quantity??1};
  if(!result.name||!result.unit||!result.category||(!itemId&&!result.locationId))throw new InventoryError(400,"SHOPPING_FIELDS_REQUIRED","error.shoppingFieldsRequired");
  if(result.locationId&&!db.prepare("SELECT 1 FROM locations WHERE id=? AND home_id=? AND active=1").get(result.locationId,homeId))throw new InventoryError(400,"LOCATION_NOT_FOUND","error.shoppingLocationInvalid");
  if(result.channelId&&result.channelId!==current?.channelId&&!db.prepare("SELECT 1 FROM shopping_channels WHERE id=? AND home_id=? AND active=1").get(result.channelId,homeId))throw new InventoryError(400,"SHOPPING_CHANNEL_NOT_FOUND","error.shoppingChannelInvalid");
  const resultId=automaticId?randomUUID():result.id;
  if(id&&!automaticId) db.prepare("UPDATE shopping_list SET item_id=?,name=?,quantity=?,unit=?,category=?,location_id=?,channel_id=?,planned_date=? WHERE id=? AND home_id=?").run(itemId,result.name,result.quantity,result.unit,result.category,result.locationId??null,result.channelId??null,result.plannedDate??null,id,homeId);
  else db.prepare("INSERT INTO shopping_list(id,home_id,item_id,name,quantity,unit,category,location_id,channel_id,planned_date,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(resultId,homeId,itemId,result.name,result.quantity,result.unit,result.category,result.locationId??null,result.channelId??null,result.plannedDate??null,automaticId?"automatic":"manual",new Date().toISOString());
  const channel=result.channelId?db.prepare("SELECT name FROM shopping_channels WHERE id=?").get(result.channelId) as {name:string}|undefined:undefined;
  return {...result,id:resultId,channelName:channel?.name??null,completed:0,source:automaticId?"automatic":result.source??"manual"};
}
export const receiveSchema=z.object({actualQuantity:z.number().positive().finite(),idempotencyKey:z.string().trim().min(1).max(200),locationId:z.string().uuid().optional(),...batchDates}).strict();
export function receiveShopping(db:DatabaseSync,homeId:string,shoppingId:string,raw:unknown) {
  const input=receiveSchema.parse(raw);
  return withStockOperation(db,homeId,input.idempotencyKey,{type:"purchase",shoppingId,...input},()=>{
    const automatic=shoppingId.startsWith("auto:");
    const row=automatic?db.prepare("SELECT id AS itemId,name,base_unit AS unit,category,default_location_id AS locationId,0 AS completed FROM items WHERE home_id=? AND id=? AND active=1").get(homeId,shoppingId.slice(5)) as Purchase|undefined
      :db.prepare("SELECT id,item_id AS itemId,name,quantity,unit,category,location_id AS locationId,channel_id AS channelId,planned_date AS plannedDate,completed FROM shopping_list WHERE home_id=? AND id=?").get(homeId,shoppingId) as Purchase|undefined;
    if(!row)throw new InventoryError(404,"SHOPPING_ITEM_NOT_FOUND","error.shoppingItemNotFound");
    if(row.completed)throw new InventoryError(409,"SHOPPING_COMPLETED","error.shoppingAlreadyReceived");
    const linked=row.itemId?db.prepare("SELECT default_location_id AS locationId FROM items WHERE id=? AND home_id=? AND active=1").get(row.itemId,homeId) as {locationId:string|null}|undefined:undefined;
    if(row.itemId&&!linked)throw new InventoryError(404,"ITEM_NOT_FOUND","error.linkedItemDeleted");
    const locationId=input.locationId??linked?.locationId??row.locationId;
    if(!locationId)throw new InventoryError(400,"SHOPPING_LOCATION_REQUIRED","error.shoppingLocationRequired");
    let itemId=row.itemId;
    if(!itemId) {
      if(!row.unit||!row.category)throw new InventoryError(400,"SHOPPING_FIELDS_REQUIRED","error.shoppingDetailsRequired");
      itemId=randomUUID();
      db.prepare("INSERT INTO items(id,home_id,sku,name,category,base_unit,default_location_id) VALUES (?,?,?,?,?,?,?)").run(itemId,homeId,`ITEM-${itemId.slice(0,8).toUpperCase()}`,row.name,row.category,row.unit,locationId);
    }
    const receipt=recordStock(db,homeId,"receipt",{itemId,locationId,quantity:input.actualQuantity,idempotencyKey:`purchase:${input.idempotencyKey}`,reason:"采购入库",manufacturedDate:input.manufacturedDate,expiryDate:input.expiryDate});
    if(!automatic)db.prepare("UPDATE shopping_list SET item_id=?,completed=1,completed_at=? WHERE home_id=? AND id=?").run(itemId,new Date().toISOString(),homeId,shoppingId);
    return {id:shoppingId,completed:true,received:input.actualQuantity,itemId,locationId,beforeQuantity:receipt.beforeQuantity,afterQuantity:receipt.afterQuantity,difference:receipt.difference,transactions:receipt.transactions};
  });
}
