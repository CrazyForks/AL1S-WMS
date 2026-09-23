import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {openDatabase} from "@al1s-wms/db";
import {listItems,pageQuery,getHomeOverview} from "./queries.js";
import {recordStock} from "./stock.js";

test("pagination keeps tied ordering and does not clamp an out-of-range offset",()=>{
  const db=openDatabase(":memory:");
  try {
    const sql="SELECT 'b' AS id, 'same' AS name UNION ALL SELECT 'a', 'same'";
    const first=pageQuery(db,sql,[],1,0,"name,id");
    assert.equal(first.items[0].id,"a");
    assert.deepEqual({...first,items:[]},{items:[],total:2,limit:1,offset:0,hasMore:true,nextOffset:1});
    const last=pageQuery(db,sql,[],1,1,"name,id");
    assert.equal(last.items[0].id,"b");assert.equal(last.hasMore,false);assert.equal(last.nextOffset,null);
    assert.deepEqual(pageQuery(db,sql,[],1,9,"name,id"),{items:[],total:2,limit:1,offset:9,hasMore:false,nextOffset:null});
  } finally {db.close();}
});

test("item descendants, home isolation and low-stock boundary agree with overview",()=>{
  const db=openDatabase(":memory:");
  try {
    const home=randomUUID(),other=randomUUID(),root=randomUUID(),child=randomUUID(),item=randomUUID();
    db.prepare("INSERT INTO homes(id,name) VALUES (?,?),(?,?)").run(home,"Home",other,"Other");
    db.prepare("INSERT INTO locations(id,home_id,name,parent_id) VALUES (?,?,?,NULL),(?,?,?,?)").run(root,home,"Root",child,home,"Child",root);
    const category=randomUUID();
    db.prepare("INSERT INTO item_categories(id,home_id,name,parent_id) VALUES (?,?,?,NULL),(?,?,?,?)").run(category,home,"Root category",randomUUID(),home,"Child category",category);
    db.prepare("INSERT INTO items(id,home_id,sku,name,category,base_unit,default_location_id,reorder_point) VALUES (?,?,?,?,?,?,?,?)").run(item,home,item,"Milk","Child category","瓶",child,2);
    const ids=(filters:Record<string,string>,homeId=home)=>(listItems(db,homeId,filters) as {id:string}[]).map(row=>row.id);
    assert.deepEqual(ids({locationId:root}),[item]);
    assert.deepEqual(ids({locationId:root,includeDescendantLocations:"false"}),[]);
    assert.deepEqual(ids({category:"Root category"}),[item]);
    assert.deepEqual(ids({category:"Root category",includeDescendantCategories:"false"}),[]);
    assert.deepEqual(ids({},other),[]);
    assert.deepEqual(ids({lowStockOnly:"true"}),[item]);
    assert.equal(getHomeOverview(db,home,{}).needsReplenishment.total,1);
    recordStock(db,home,"receipt",{itemId:item,locationId:child,quantity:2,idempotencyKey:"boundary"});
    assert.deepEqual(ids({lowStockOnly:"true"}),[]);
    assert.equal(getHomeOverview(db,home,{}).needsReplenishment.total,0);
    assert.throws(()=>listItems(db,home,{limit:0}));
    assert.throws(()=>listItems(db,home,{unknown:true}));
  } finally {db.close();}
});
