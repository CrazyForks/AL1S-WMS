import { z } from "zod";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { transactionQuery } from "./inventory-delete.js";
import { batchBalanceQuery } from "./stock.js";

const bool = z.enum(["true","false"]).transform(value=>value==="true");
const paging = { limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).default(0) };
export const transactionFilters = z.object({...paging,itemId:z.string().uuid().optional(),locationId:z.string().uuid().optional(),batchId:z.string().uuid().optional(),type:z.enum(["receipt","issue","move","delete","reclassify","update"]).optional(),query:z.string().trim().max(200).optional(),occurredFrom:z.string().datetime().optional(),occurredTo:z.string().datetime().optional(),snapshotAt:z.string().datetime().optional()}).strict();
export const itemFilters = z.object({...paging,paged:bool.optional(),query:z.string().trim().max(200).optional(),category:z.string().trim().max(200).optional(),locationId:z.string().uuid().optional(),includeDescendantLocations:bool.default("true"),includeDescendantCategories:bool.default("true"),lowStockOnly:bool.optional(),expiryBefore:z.string().date().optional()}).strict();
export const batchFilters = z.object({...paging,itemId:z.string().uuid().optional(),locationId:z.string().uuid().optional(),includeEmpty:bool.default("false")}).strict();
export function pageQuery(db:DatabaseSync,sql:string,params:SQLInputValue[],limit:number,offset:number,order:string) {
  const total=(db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as {n:number}).n;
  const items=db.prepare(`SELECT * FROM (${sql}) ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params,limit,offset);
  const nextOffset=offset+items.length<total?offset+items.length:null;
  return {items,total,limit,offset,hasMore:nextOffset!==null,nextOffset};
}
export function listTransactions(db:DatabaseSync,homeId:string,raw:unknown) {
  const filters=transactionFilters.parse(raw), snapshotAt=filters.snapshotAt??new Date().toISOString();
  const where=["homeId=?","occurredAt<=?"],params:SQLInputValue[]=[homeId,snapshotAt];
  for(const key of ["itemId","locationId","batchId","type"] as const) if(filters[key]) {where.push(`${key}=?`);params.push(filters[key]!);}
  if(filters.query) {where.push("(itemName LIKE ? OR reason LIKE ?)");params.push(`%${filters.query}%`,`%${filters.query}%`);}
  if(filters.occurredFrom) {where.push("occurredAt>=?");params.push(filters.occurredFrom);}
  if(filters.occurredTo) {where.push("occurredAt<=?");params.push(filters.occurredTo);}
  return {...pageQuery(db,`SELECT * FROM (${transactionQuery}) WHERE ${where.join(" AND ")}`,params,filters.limit,filters.offset,"occurredAt DESC,id DESC"),snapshotAt};
}
function descendants(db:DatabaseSync,homeId:string,table:"locations"|"item_categories",id:string,include:boolean) {
  const result=[id];
  if(include) for(let index=0;index<result.length;index++) {
    const rows=db.prepare(`SELECT id FROM ${table} WHERE home_id=? AND parent_id=? AND active=1`).all(homeId,result[index]) as {id:string}[];
    for(const row of rows) if(!result.includes(row.id)) result.push(row.id);
  }
  return result;
}
export function listItems(db:DatabaseSync,homeId:string,raw:unknown) {
  const filters=itemFilters.parse(raw),where=["i.home_id=?","i.active=1"],params:SQLInputValue[]=[homeId];
  const balance="(SELECT COALESCE(SUM(CASE WHEN type='receipt' THEN quantity ELSE -quantity END),0) FROM stock_transactions WHERE home_id=i.home_id AND item_id=i.id)";
  if(filters.query){where.push("i.name LIKE ?");params.push(`%${filters.query}%`);}
  if(filters.locationId) {
    const ids=descendants(db,homeId,"locations",filters.locationId,filters.includeDescendantLocations),marks=ids.map(()=>"?").join(",");
    where.push(`(i.default_location_id IN (${marks}) OR EXISTS (SELECT 1 FROM stock_transactions st WHERE st.home_id=i.home_id AND st.item_id=i.id AND st.location_id IN (${marks}) GROUP BY st.location_id HAVING SUM(CASE WHEN st.type='receipt' THEN st.quantity ELSE -st.quantity END)>0))`);params.push(...ids,...ids);
  }
  if(filters.category) {
    const roots=db.prepare("SELECT id FROM item_categories WHERE home_id=? AND name=? AND active=1").all(homeId,filters.category) as {id:string}[];
    const ids=roots.flatMap(root=>descendants(db,homeId,"item_categories",root.id,filters.includeDescendantCategories));
    const names=ids.length?(db.prepare(`SELECT name FROM item_categories WHERE home_id=? AND id IN (${ids.map(()=>"?").join(",")})`).all(homeId,...ids) as {name:string}[]).map(row=>row.name):[filters.category];
    where.push(`i.category IN (${names.map(()=>"?").join(",")})`);params.push(...names);
  }
  if(filters.lowStockOnly)where.push(`${balance}<i.reorder_point`);
  if(filters.expiryBefore){where.push("i.expiry_date<=?");params.push(filters.expiryBefore);}
  const sql=`SELECT i.icon,i.id,i.home_id AS homeId,i.sku,i.name,i.category,i.base_unit AS baseUnit,i.reorder_point AS reorderPoint,i.reorder_quantity AS reorderQuantity,i.manufactured_date AS manufacturedDate,i.expiry_date AS expiryDate,i.default_location_id AS locationId,l.name AS locationName,i.active,${balance} AS quantity FROM items i LEFT JOIN locations l ON l.id=i.default_location_id WHERE ${where.join(" AND ")}`;
  return filters.paged
    ? pageQuery(db,sql,params,filters.limit,filters.offset,"name,id")
    : db.prepare(`SELECT * FROM (${sql}) ORDER BY name,id`).all(...params);
}
export function listBatches(db:DatabaseSync,homeId:string,raw:unknown) {
  const filters=batchFilters.parse(raw),where=["homeId=?"],params:SQLInputValue[]=[homeId];
  for(const key of ["itemId","locationId"] as const)if(filters[key]){where.push(`${key}=?`);params.push(filters[key]!);}
  if(!filters.includeEmpty)where.push("quantity>0");
  return pageQuery(db,`SELECT * FROM (${batchBalanceQuery}) WHERE ${where.join(" AND ")}`,params,filters.limit,filters.offset,"expiryDate IS NULL,expiryDate,receivedAt,batchId,locationId");
}
