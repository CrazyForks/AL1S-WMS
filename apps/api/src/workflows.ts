import {randomUUID} from "node:crypto";
import type {DatabaseSync,SQLInputValue} from "node:sqlite";
import {z} from "zod";
import {atomic,InventoryError,ledgerEntry,recordItemEvent,reconcileStock,refreshItemDates,requireStockTarget,stockAt,withStockOperation} from "./stock.js";
import {nonnegativeQuantity} from "./quantity.js";

// Snapshots are scoped to one household and only persisted as changed rows.
// All callers run synchronously inside the inventory transaction.
const tables=["stock_transactions","stock_batches","opened_consumables","shopping_list"] as const;
type Table=typeof tables[number];
type Row=Record<string,SQLInputValue> & {id:string};
type Snapshot=Record<Table,Map<string,Row>>;
type Change={table:Table;before:Row|null;after:Row|null};
type Journal={changes:Change[];footprints:Record<string,string>;items:string[]};
const active=new WeakSet<DatabaseSync>();
export function startWorkflow(db:DatabaseSync,homeId:string){
 if(active.has(db))return null;
 active.add(db);
 try {return Object.fromEntries(tables.map(table=>[table,new Map((db.prepare(`SELECT * FROM ${table} WHERE home_id=?`).all(homeId) as Row[]).map(row=>[row.id,row]))])) as Snapshot;}
 catch(error){active.delete(db);throw error;}
}
export function endWorkflow(db:DatabaseSync){active.delete(db);}
function footprint(db:DatabaseSync,homeId:string,batchId:string){
 return JSON.stringify({batch:db.prepare("SELECT * FROM stock_batches WHERE home_id=? AND id=?").get(homeId,batchId),
 ledger:db.prepare("SELECT * FROM stock_transactions WHERE home_id=? AND batch_id=? ORDER BY id").all(homeId,batchId),
 opened:db.prepare("SELECT * FROM opened_consumables WHERE home_id=? AND batch_id=? ORDER BY id").all(homeId,batchId)});
}
export function finishWorkflow(db:DatabaseSync,homeId:string,key:string,payload:unknown,before:Snapshot){
 const changes:Change[]=[];
 for(const table of tables){
  const after=new Map((db.prepare(`SELECT * FROM ${table} WHERE home_id=?`).all(homeId) as Row[]).map(row=>[row.id,row]));
  for(const id of new Set([...before[table].keys(),...after.keys()])){
   const old=before[table].get(id)??null,next=after.get(id)??null;
   if(JSON.stringify(old)!==JSON.stringify(next))changes.push({table,before:old,after:next});
  }
 }
 if(!changes.length)return;
 const batchIds=new Set<string>(),itemIds=new Set<string>();
 for(const change of changes){const row=change.after??change.before!;if(row.item_id)itemIds.add(String(row.item_id));if(change.table==="stock_batches")batchIds.add(row.id);else if(row.batch_id)batchIds.add(String(row.batch_id));}
 const items=[...itemIds];
 const names=items.map(id=>(db.prepare("SELECT name FROM items WHERE home_id=? AND id=?").get(homeId,id) as {name:string}).name);
 const journal:Journal={changes,items,footprints:Object.fromEntries([...batchIds].map(id=>[id,footprint(db,homeId,id)]))};
 const kind=(payload as {type?:string})?.type??"stock";
 db.prepare("INSERT INTO workflow_operations(id,home_id,operation_key,kind,created_at,summary,changes) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),homeId,key,kind,new Date().toISOString(),names.join("、"),JSON.stringify(journal));
}
function unchanged(db:DatabaseSync,homeId:string,journal:Journal){
 for(const id of journal.items)if(!db.prepare("SELECT 1 FROM items WHERE id=? AND home_id=? AND active=1").get(id,homeId))return false;
 for(const [id,version] of Object.entries(journal.footprints))if(footprint(db,homeId,id)!==version)return false;
 for(const change of journal.changes.filter(row=>row.table==="shopping_list")){
  const row=change.after??change.before!;
  if(JSON.stringify(db.prepare("SELECT * FROM shopping_list WHERE id=? AND home_id=?").get(row.id,homeId)??null)!==JSON.stringify(change.after))return false;
 }
 return true;
}
export function listWorkflowOperations(db:DatabaseSync,homeId:string){
 const rows=db.prepare("SELECT id,kind,created_at AS createdAt,summary,changes,undone_at AS undoneAt FROM workflow_operations WHERE home_id=? ORDER BY sequence DESC LIMIT 30").all(homeId) as {id:string;kind:string;createdAt:string;summary:string;changes:string;undoneAt:string|null}[];
 return {items:rows.map(({changes,...row})=>({...row,canUndo:!row.undoneAt&&unchanged(db,homeId,JSON.parse(changes))}))};
}
export function undoWorkflowOperation(db:DatabaseSync,homeId:string,id:string){
 return atomic(db,()=>{
  const operation=db.prepare("SELECT * FROM workflow_operations WHERE id=? AND home_id=?").get(id,homeId) as {changes:string;undone_at:string|null}|undefined;
  if(!operation)throw new InventoryError(404,"OPERATION_NOT_FOUND","error.operationNotFound");
  if(operation.undone_at)return {id,undone:true};
  const journal=JSON.parse(operation.changes) as Journal;
  if(!unchanged(db,homeId,journal))throw new InventoryError(409,"UNDO_HAS_DEPENDENCIES","error.undoHasDependencies");
  for(const change of journal.changes.filter(row=>row.table==="stock_transactions")){
   if(change.before||!change.after)throw new InventoryError(409,"UNDO_UNSUPPORTED","error.undoHasDependencies");
   const row=change.after;
   requireStockTarget(db,homeId,String(row.item_id),String(row.location_id));
   db.prepare("UPDATE stock_transactions SET reversed_by=? WHERE id=? AND home_id=?").run(id,row.id,homeId);
   const inverse=ledgerEntry(db,homeId,String(row.item_id),String(row.location_id),String(row.batch_id),row.type==="receipt"?"issue":"receipt",Number(row.quantity),`event:undo:${id}:${row.id}`,"reason.undoOperation");
   db.prepare("UPDATE stock_transactions SET reversed_by=? WHERE id=?").run(id,inverse);
  }
  for(const change of journal.changes.filter(row=>row.table==="stock_batches"&&row.before===null))db.prepare("UPDATE stock_batches SET voided=1 WHERE id=? AND home_id=?").run(change.after!.id,homeId);
  for(const change of journal.changes.filter(row=>row.table==="opened_consumables"||row.table==="shopping_list")){
   if(change.before){
    const columns=Object.keys(change.before);
    db.prepare(`INSERT OR REPLACE INTO ${change.table} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...columns.map(column=>change.before![column]));
   }else if(change.after&&change.table==="opened_consumables")db.prepare("DELETE FROM opened_consumables WHERE id=? AND home_id=?").run(change.after.id,homeId);
   else if(change.after)db.prepare("UPDATE shopping_list SET completed=0,completed_at=NULL,quantity=COALESCE(planned_quantity,quantity),received_quantity=0 WHERE id=? AND home_id=?").run(change.after.id,homeId);
  }
  for(const itemId of journal.items){refreshItemDates(db,homeId,itemId);recordItemEvent(db,homeId,itemId,"update","reason.undoOperation");}
  db.prepare("UPDATE workflow_operations SET undone_at=? WHERE id=? AND home_id=?").run(new Date().toISOString(),id,homeId);
  return {id,undone:true};
 });
}
export function previewStocktake(db:DatabaseSync,homeId:string,locationId:string){
 z.string().uuid().parse(locationId);
 if(!db.prepare("SELECT 1 FROM locations WHERE id=? AND home_id=? AND active=1").get(locationId,homeId))throw new InventoryError(404,"LOCATION_NOT_FOUND","error.locationNotInHome");
 const items=db.prepare(`SELECT i.id AS itemId,i.name,i.base_unit AS unit,ROUND(COALESCE(SUM(CASE WHEN t.type='receipt' THEN t.quantity ELSE -t.quantity END),0),2) AS quantity
 FROM items i LEFT JOIN stock_transactions t ON t.item_id=i.id AND t.home_id=i.home_id AND t.location_id=? WHERE i.home_id=? AND i.active=1
 GROUP BY i.id HAVING quantity>0 OR i.default_location_id=? ORDER BY i.name,i.id`).all(locationId,homeId,locationId);
 return {locationId,items};
}
function categoryNames(db:DatabaseSync,homeId:string,categoryId:string){
 const names=db.prepare(`WITH RECURSIVE selected(id,name) AS (
  SELECT id,name FROM item_categories WHERE id=? AND home_id=? AND active=1
  UNION ALL SELECT child.id,child.name FROM item_categories child JOIN selected parent ON child.parent_id=parent.id WHERE child.home_id=? AND child.active=1
 ) SELECT name FROM selected`).all(categoryId,homeId,homeId) as {name:string}[];
 if(!names.length)throw new InventoryError(404,"CATEGORY_NOT_FOUND","error.categoryNotFound");
 return names.map(row=>row.name);
}
export function previewCategoryStocktake(db:DatabaseSync,homeId:string,categoryId:string){
 const names=categoryNames(db,homeId,categoryId);
 const items=db.prepare(`SELECT i.id AS itemId,i.name,i.base_unit AS unit,l.id AS locationId,l.name AS locationName,
 ROUND(COALESCE(SUM(CASE WHEN t.type='receipt' THEN t.quantity ELSE -t.quantity END),0),2) AS quantity
 FROM items i JOIN locations l ON l.home_id=i.home_id AND l.active=1
 LEFT JOIN stock_transactions t ON t.item_id=i.id AND t.home_id=i.home_id AND t.location_id=l.id
 WHERE i.home_id=? AND i.active=1 AND i.category IN (${names.map(()=>"?").join(",")})
 GROUP BY i.id,l.id HAVING quantity>0 OR i.default_location_id=l.id ORDER BY i.name,l.name,i.id,l.id`).all(homeId,...names);
 return {categoryId,items};
}
export function confirmStocktake(db:DatabaseSync,homeId:string,raw:unknown){
 const input=z.object({locationId:z.string().uuid().optional(),categoryId:z.string().uuid().optional(),idempotencyKey:z.string().min(1).max(160),rows:z.array(z.object({itemId:z.string().uuid(),locationId:z.string().uuid().optional(),expectedQuantity:nonnegativeQuantity,countedQuantity:nonnegativeQuantity})).min(1).max(1000)}).strict().parse(raw);
 if(Number(!!input.locationId)+Number(!!input.categoryId)!==1)throw new InventoryError(400,"INVALID_FIELDS","error.validation");
 return withStockOperation(db,homeId,input.idempotencyKey,{type:"stocktake",...input},()=>{
  const names=input.categoryId?new Set(categoryNames(db,homeId,input.categoryId)):null;
  const rows=input.rows.map(row=>({ ...row,locationId:input.locationId??row.locationId }));
  if(rows.some(row=>!row.locationId||(input.locationId&&row.locationId!==input.locationId))||new Set(rows.map(row=>`${row.itemId}:${row.locationId}`)).size!==rows.length)throw new InventoryError(400,"INVALID_FIELDS","error.validation");
  for(const row of rows){
   requireStockTarget(db,homeId,row.itemId,row.locationId);
   if(names){const item=db.prepare("SELECT category FROM items WHERE id=? AND home_id=?").get(row.itemId,homeId) as {category:string};if(!names.has(item.category))throw new InventoryError(400,"INVALID_FIELDS","error.validation");}
   if(stockAt(db,homeId,row.itemId,row.locationId!)!==row.expectedQuantity)throw new InventoryError(409,"STOCKTAKE_STALE","error.stocktakeStale");
  }
  // An opened amount cannot be silently removed by a physical count.
  for(const row of rows){const opened=db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM opened_consumables WHERE home_id=? AND item_id=? AND location_id=?").get(homeId,row.itemId,row.locationId!) as {n:number};if(row.countedQuantity<opened.n)throw new InventoryError(409,"OPENED_STOCK_CONFLICT","error.stocktakeOpened");}
  return {items:rows.map(row=>reconcileStock(db,homeId,{itemId:row.itemId,locationId:row.locationId,countedQuantity:row.countedQuantity,idempotencyKey:`stocktake:${input.idempotencyKey}:${row.itemId}:${row.locationId}`}))};
 });
}
