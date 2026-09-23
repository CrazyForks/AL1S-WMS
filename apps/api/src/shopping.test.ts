import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {openDatabase} from "@al1s-wms/db";
import {saveShopping,receiveShopping} from "./shopping.js";
import {recordStock,listOpenedConsumables} from "./stock.js";

for(const consumptionType of ["consumable","non_consumable","long_term_consumable"] as const){
  test(`purchase preserves ${consumptionType} through edits and idempotent receipt`,()=>{
    const db=openDatabase(":memory:"),home=randomUUID(),location=randomUUID();
    try{
      db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(home,"home");
      db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(location,home,"shelf");
      const purchase=saveShopping(db,home,{name:"purchase",unit:"个",category:"其他",locationId:location,consumptionType,openedShelfLifeDays:7});
      const edited=saveShopping(db,home,{quantity:2},purchase.id);
      assert.equal(edited.consumptionType,consumptionType);assert.equal(edited.openedShelfLifeDays,consumptionType==="long_term_consumable"?7:null);
      const input={actualQuantity:2,idempotencyKey:"receive"};
      const result=receiveShopping(db,home,purchase.id,input);
      assert.deepEqual(receiveShopping(db,home,purchase.id,input),result);
      const item=db.prepare("SELECT consumption_type,opened_shelf_life_days FROM items WHERE id=?").get(result.itemId)!;
      assert.equal(item.consumption_type,consumptionType);assert.equal(item.opened_shelf_life_days,consumptionType==="long_term_consumable"?7:null);
      if(consumptionType==="long_term_consumable"){
        const opened=recordStock(db,home,"issue",{itemId:result.itemId,locationId:location,quantity:1,idempotencyKey:"open"});
        assert.equal(opened.afterQuantity,2);assert.equal(listOpenedConsumables(db,home).length,1);
      }
      assert.throws(()=>saveShopping(db,home,{consumptionType:"invalid"}));
      assert.throws(()=>saveShopping(db,home,{consumptionType:"long_term_consumable",openedShelfLifeDays:0}));
    }finally{db.close();}
  });
}
test("old purchases default to consumable and linked purchases keep existing item type",()=>{
  const db=openDatabase(":memory:"),home=randomUUID(),location=randomUUID(),item=randomUUID();
  try{
    db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(home,"home");
    db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(location,home,"shelf");
    const legacy=saveShopping(db,home,{name:"legacy",unit:"个",category:"其他",locationId:location});
    assert.equal(legacy.consumptionType,"consumable");
    db.prepare("INSERT INTO items(id,home_id,sku,name,category,base_unit,default_location_id,consumption_type,opened_shelf_life_days) VALUES (?,?,?,?,?,?,?,?,?)").run(item,home,item,"existing","其他","个",location,"long_term_consumable",9);
    const linked=saveShopping(db,home,{itemId:item,consumptionType:"non_consumable",openedShelfLifeDays:1});
    assert.equal(linked.consumptionType,"long_term_consumable");assert.equal(linked.openedShelfLifeDays,9);
    receiveShopping(db,home,linked.id,{actualQuantity:1,idempotencyKey:"linked"});
    assert.equal(db.prepare("SELECT consumption_type FROM items WHERE id=?").get(item)!.consumption_type,"long_term_consumable");
    const edit=saveShopping(db,home,{consumptionType:"non_consumable",openedShelfLifeDays:null},legacy.id);
    assert.equal(edit.consumptionType,"non_consumable");assert.equal(edit.openedShelfLifeDays,null);
  }finally{db.close();}
});

test("shopping HTTP list and calendar round-trip consumption settings",async()=>{
  const {buildApp}=await import("./app.js");
  const db=openDatabase(":memory:"),home=randomUUID(),location=randomUUID(),user=randomUUID(),session=randomUUID();
  db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(home,"home");
  db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(location,home,"shelf");
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)").run(user,"test","unused",new Date().toISOString());
  db.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES (?,?,?)").run(session,user,"2099-01-01T00:00:00.000Z");
  const app=await buildApp(db),headers={cookie:`session=${session}`},url=`/api/v1/homes/${home}/shopping-list`;
  try{
    const created=await app.inject({method:"POST",url,headers,payload:{name:"soap",unit:"个",category:"其他",locationId:location,consumptionType:"long_term_consumable",openedShelfLifeDays:30,plannedDate:"2026-09-25"}});
    assert.equal(created.statusCode,201);
    for(const path of [url,`/api/v1/homes/${home}/shopping-calendar?month=2026-09`]){
      const rows=(await app.inject({url:path,headers})).json();
      assert.equal(rows[0].consumptionType,"long_term_consumable");assert.equal(rows[0].openedShelfLifeDays,30);
    }
    const updated=await app.inject({method:"PATCH",url:`${url}/${created.json().id}`,headers,payload:{consumptionType:"non_consumable",openedShelfLifeDays:null}});
    assert.equal(updated.statusCode,200);
    const result=await app.inject({method:"POST",url:`${url}/${created.json().id}/receive`,headers,payload:{actualQuantity:1,idempotencyKey:"http"}});
    assert.equal(result.statusCode,200);
    assert.equal(db.prepare("SELECT consumption_type FROM items WHERE id=?").get(result.json().itemId)!.consumption_type,"non_consumable");
  }finally{await app.close();db.close();}
});

test("existing database upgrades shopping columns with compatible defaults and reopens",async()=>{
  const {mkdtempSync,rmSync}=await import("node:fs");
  const {tmpdir}=await import("node:os");const {join}=await import("node:path");
  const dir=mkdtempSync(join(tmpdir(),"al1s-shopping-")),path=join(dir,"test.db");
  let db=openDatabase(path);
  try{
    const home=randomUUID(),id=randomUUID();
    db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(home,"home");
    db.prepare("INSERT INTO shopping_list(id,home_id,name,created_at) VALUES (?,?,?,?)").run(id,home,"old","2026-09-01");
    db.exec("ALTER TABLE shopping_list DROP COLUMN consumption_type; ALTER TABLE shopping_list DROP COLUMN opened_shelf_life_days;");
    db.close();db=openDatabase(path);
    const row=db.prepare("SELECT consumption_type,opened_shelf_life_days FROM shopping_list WHERE id=?").get(id)!;
    assert.equal(row.consumption_type,"consumable");assert.equal(row.opened_shelf_life_days,null);
    db.close();db=openDatabase(path);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM shopping_list").get()!.n,1);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test("purchase ignores mismatched shelf life, clears it on type change and preserves long-term partial edits",()=>{
  const db=openDatabase(":memory:"),home=randomUUID(),location=randomUUID();
  try{
    db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(home,"home");
    db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(location,home,"shelf");
    for(const consumptionType of ["consumable","non_consumable"]){
      const row=saveShopping(db,home,{name:"item",unit:"个",category:"其他",locationId:location,consumptionType,openedShelfLifeDays:"invalid"});
      assert.equal(row.openedShelfLifeDays,null);
      assert.equal(saveShopping(db,home,{openedShelfLifeDays:-1},row.id).openedShelfLifeDays,null);
    }
    const long=saveShopping(db,home,{name:"long",unit:"个",category:"其他",locationId:location,consumptionType:"long_term_consumable",openedShelfLifeDays:12});
    assert.equal(saveShopping(db,home,{quantity:2},long.id).openedShelfLifeDays,12);
    assert.throws(()=>saveShopping(db,home,{openedShelfLifeDays:"bad"},long.id));
    const short=saveShopping(db,home,{consumptionType:"consumable",openedShelfLifeDays:{forced:true}},long.id);
    assert.equal(short.openedShelfLifeDays,null);
    assert.equal(saveShopping(db,home,{consumptionType:"long_term_consumable"},long.id).openedShelfLifeDays,null);
  }finally{db.close();}
});
