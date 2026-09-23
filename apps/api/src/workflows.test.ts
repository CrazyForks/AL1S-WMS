import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {openDatabase} from "@al1s-wms/db";
import {recordStock,transferStock,stockAt,listOpenedConsumables,exhaustOpenedConsumable} from "./stock.js";
import {saveShopping,receiveShopping} from "./shopping.js";
import {inventoryCostAnalysis} from "./pricing.js";
import {listWorkflowOperations,undoWorkflowOperation,previewStocktake,previewCategoryStocktake,confirmStocktake} from "./workflows.js";
function fixture(){
 const db=openDatabase(":memory:"),home=randomUUID(),item=randomUUID(),a=randomUUID(),b=randomUUID();
 db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(home,"home");
 for(const [id,name] of [[a,"A"],[b,"B"]])db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(id,home,name);
 db.prepare("INSERT INTO items(id,home_id,sku,name,base_unit,category,default_location_id) VALUES (?,?,?,?,?,?,?)").run(item,home,item,"soap","瓶","其他",a);
 return {db,home,item,a,b};
}
test("partial transfer and opening at another location preserve batch costs and total inventory",()=>{
 const {db,home,item,a,b}=fixture();try{
 const receipt=recordStock(db,home,"receipt",{itemId:item,locationId:a,quantity:20,totalPrice:40,idempotencyKey:"receipt"});
 const request={itemId:item,sourceLocationId:a,targetLocationId:b,quantity:10,idempotencyKey:"move"};
 const move=transferStock(db,home,request);assert.deepEqual(transferStock(db,home,request),move);
 assert.equal(stockAt(db,home,item,a),10);assert.equal(stockAt(db,home,item,b),10);
 assert.equal(move.batches[0].batchId,receipt.transactions[0].batchId);
 db.prepare("UPDATE items SET consumption_type='long_term_consumable',opened_shelf_life_days=10 WHERE id=?").run(item);
 const open={itemId:item,locationId:a,targetLocationId:b,quantity:2,idempotencyKey:"open"};
 recordStock(db,home,"issue",open);recordStock(db,home,"issue",open);
 assert.equal(stockAt(db,home,item,a),8);assert.equal(stockAt(db,home,item,b),12);
 const opened=listOpenedConsumables(db,home);assert.equal(opened.length,1);assert.equal(opened[0].locationId,b);assert.equal(opened[0].quantity,2);
 const month=new Date().toISOString().slice(0,7);const cost=inventoryCostAnalysis(db,home,{start:month,end:month});
 assert.equal(cost.totals.consumed,0);assert.equal(cost.cohorts.points[0].originalCost,40);
 assert.throws(()=>recordStock(db,home,"issue",{...open,targetLocationId:randomUUID(),idempotencyKey:"bad"}));assert.equal(stockAt(db,home,item,a),8);
 }finally{db.close();}
});
test("partial receipts retain only outstanding plan, retries and undo restore stock and finances",()=>{
 const {db,home,item,a}=fixture();try{
 const plan=saveShopping(db,home,{itemId:item,quantity:12,estimatedTotal:24});
 const req={actualQuantity:8,totalPrice:16,completion:"keep",idempotencyKey:"part"};
 const first=receiveShopping(db,home,plan.id,req);assert.equal(first.completed,false);assert.equal(first.remaining,4);
 assert.deepEqual(receiveShopping(db,home,plan.id,req),first);
 let row=db.prepare("SELECT * FROM shopping_list WHERE id=?").get(plan.id)!;assert.equal(row.quantity,4);assert.equal(row.estimated_total_minor,800);
 receiveShopping(db,home,plan.id,{actualQuantity:4,totalPrice:8,idempotencyKey:"last"});assert.equal(stockAt(db,home,item,a),12);
 const last=listWorkflowOperations(db,home).items[0];undoWorkflowOperation(db,home,last.id);
 assert.equal(stockAt(db,home,item,a),8);row=db.prepare("SELECT * FROM shopping_list WHERE id=?").get(plan.id)!;assert.equal(row.completed,0);assert.equal(row.quantity,4);
 const month=new Date().toISOString().slice(0,7);assert.equal(inventoryCostAnalysis(db,home,{start:month,end:month}).totals.inbound,16);
 undoWorkflowOperation(db,home,last.id);assert.equal(stockAt(db,home,item,a),8);
 }finally{db.close();}
});
test("undo preserves history, blocks dependent receipts, restores issues and opening",()=>{
 const {db,home,item,a,b}=fixture();try{
 recordStock(db,home,"receipt",{itemId:item,locationId:a,quantity:10,totalPrice:20,idempotencyKey:"r"});const receipt=listWorkflowOperations(db,home).items[0];
 recordStock(db,home,"issue",{itemId:item,locationId:a,quantity:2,issueReason:"expired",idempotencyKey:"i"});const issue=listWorkflowOperations(db,home).items[0];
 assert.throws(()=>undoWorkflowOperation(db,home,receipt.id));assert.throws(()=>undoWorkflowOperation(db,randomUUID(),issue.id));
 undoWorkflowOperation(db,home,issue.id);assert.equal(stockAt(db,home,item,a),10);
 const month=new Date().toISOString().slice(0,7);assert.equal(inventoryCostAnalysis(db,home,{start:month,end:month}).totals.wasted,0);
 assert.ok(Number(db.prepare("SELECT COUNT(*) AS n FROM stock_transactions").get()!.n)>=3);
 db.prepare("UPDATE items SET consumption_type='long_term_consumable' WHERE id=?").run(item);
 recordStock(db,home,"issue",{itemId:item,locationId:a,targetLocationId:b,quantity:1,idempotencyKey:"o"});
 undoWorkflowOperation(db,home,listWorkflowOperations(db,home).items[0].id);
 assert.equal(listOpenedConsumables(db,home).length,0);assert.equal(stockAt(db,home,item,b),0);
 }finally{db.close();}
});
test("location stocktake previews without writes and rejects stale counts atomically",()=>{
 const {db,home,item,a}=fixture();try{
 recordStock(db,home,"receipt",{itemId:item,locationId:a,quantity:10,idempotencyKey:"r"});
 const preview=previewStocktake(db,home,a);assert.equal(preview.items[0].quantity,10);
 const req={locationId:a,rows:[{itemId:item,expectedQuantity:10,countedQuantity:8}],idempotencyKey:"count"};
 confirmStocktake(db,home,req);assert.equal(stockAt(db,home,item,a),8);
 confirmStocktake(db,home,req);assert.equal(stockAt(db,home,item,a),8);
 assert.throws(()=>confirmStocktake(db,home,{...req,idempotencyKey:"stale"}));assert.equal(stockAt(db,home,item,a),8);
 undoWorkflowOperation(db,home,listWorkflowOperations(db,home).items[0].id);assert.equal(stockAt(db,home,item,a),10);
 }finally{db.close();}
});
test("category stocktake counts descendant items separately at each location and validates scope",()=>{
 const {db,home,item,a,b}=fixture();try{
  const parent=randomUUID(),child=randomUUID();
  db.prepare("INSERT INTO item_categories(id,home_id,name) VALUES (?,?,?)").run(parent,home,"Supplies");
  db.prepare("INSERT INTO item_categories(id,home_id,parent_id,name) VALUES (?,?,?,?)").run(child,home,parent,"Cleaning");
  db.prepare("UPDATE items SET category='Cleaning' WHERE id=?").run(item);
  recordStock(db,home,"receipt",{itemId:item,locationId:a,quantity:10,idempotencyKey:"category-receipt"});
  transferStock(db,home,{itemId:item,sourceLocationId:a,targetLocationId:b,quantity:4,idempotencyKey:"category-move"});
  const rows=previewCategoryStocktake(db,home,parent).items as {itemId:string;locationId:string;quantity:number}[];
  assert.deepEqual(rows.map(row=>row.quantity).sort((x,y)=>x-y),[4,6]);
  const request={categoryId:parent,idempotencyKey:"category-count",rows:rows.map(row=>({itemId:item,locationId:row.locationId,expectedQuantity:row.quantity,countedQuantity:row.quantity-1}))};
  assert.throws(()=>confirmStocktake(db,home,{...request,idempotencyKey:"invalid-category",categoryId:randomUUID()}));
  confirmStocktake(db,home,request);
  assert.equal(stockAt(db,home,item,a),5);assert.equal(stockAt(db,home,item,b),3);
  assert.throws(()=>confirmStocktake(db,home,{...request,idempotencyKey:"stale-category"}));
 }finally{db.close();}
});

test("moving part of opened stock retains opened date and can be reversed",()=>{
 const {db,home,item,a,b}=fixture();try{
 db.prepare("UPDATE items SET consumption_type='long_term_consumable',opened_shelf_life_days=7 WHERE id=?").run(item);
 recordStock(db,home,"receipt",{itemId:item,locationId:a,quantity:5,idempotencyKey:"r"});
 recordStock(db,home,"issue",{itemId:item,locationId:a,quantity:3,idempotencyKey:"o"});
 const original=listOpenedConsumables(db,home)[0];
 transferStock(db,home,{itemId:item,sourceLocationId:a,targetLocationId:b,quantity:1,openedId:original.id,idempotencyKey:"move-open"});
 const rows=listOpenedConsumables(db,home);assert.equal(rows.find(r=>r.locationId===a)!.quantity,2);assert.equal(rows.find(r=>r.locationId===b)!.quantity,1);
 assert.equal(rows.find(r=>r.locationId===b)!.openedAt,original.openedAt);assert.equal(rows.find(r=>r.locationId===b)!.openedExpiryDate,original.openedExpiryDate);
 undoWorkflowOperation(db,home,listWorkflowOperations(db,home).items[0].id);assert.equal(listOpenedConsumables(db,home)[0].quantity,3);assert.equal(stockAt(db,home,item,b),0);
 exhaustOpenedConsumable(db,home,{id:original.id,quantity:1,idempotencyKey:"exhaust"});
 undoWorkflowOperation(db,home,listWorkflowOperations(db,home).items[0].id);assert.equal(listOpenedConsumables(db,home)[0].quantity,3);assert.equal(stockAt(db,home,item,a),5);
 }finally{db.close();}
});

test("invalid transfers and multi-item stale stocktakes leave all stock unchanged",()=>{
 const {db,home,item,a,b}=fixture();try{
 recordStock(db,home,"receipt",{itemId:item,locationId:a,quantity:20,idempotencyKey:"r"});
 const request={itemId:item,sourceLocationId:a,targetLocationId:b,quantity:21,idempotencyKey:"bad"};
 assert.throws(()=>transferStock(db,home,request));
 assert.throws(()=>transferStock(db,randomUUID(),{...request,quantity:1}));
 assert.equal(stockAt(db,home,item,a),20);assert.equal(stockAt(db,home,item,b),0);
 const other=randomUUID();db.prepare("INSERT INTO items(id,home_id,sku,name,base_unit,category,default_location_id) VALUES (?,?,?,?,?,?,?)").run(other,home,other,"second","个","其他",a);
 assert.throws(()=>confirmStocktake(db,home,{locationId:a,idempotencyKey:"bad-count",rows:[{itemId:item,expectedQuantity:20,countedQuantity:18},{itemId:other,expectedQuantity:1,countedQuantity:0}]}));
 assert.equal(stockAt(db,home,item,a),20);assert.equal(listWorkflowOperations(db,home).items.length,1);
 }finally{db.close();}
});


test("workflow migration upgrades older databases and remains safe on reopen",()=>{
 const directory=mkdtempSync(join(tmpdir(),"al1s-workflow-migration-")),path=join(directory,"test.sqlite");
 try {
  let db=openDatabase(path);
  db.exec("DROP VIEW cost_transactions; DROP VIEW cost_batches; DROP TABLE workflow_operations; ALTER TABLE stock_transactions DROP COLUMN reversed_by; ALTER TABLE stock_batches DROP COLUMN voided; ALTER TABLE shopping_list DROP COLUMN planned_quantity; ALTER TABLE shopping_list DROP COLUMN received_quantity;");
  const home=randomUUID();db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(home,"legacy");db.close();
  db=openDatabase(path);assert.equal(db.prepare("SELECT name FROM homes WHERE id=?").get(home)!.name,"legacy");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cost_transactions").get()!.n,0);assert.deepEqual(listWorkflowOperations(db,home),{items:[]});db.close();
  db=openDatabase(path);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cost_batches").get()!.n,0);db.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
