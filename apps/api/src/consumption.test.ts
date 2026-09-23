import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {openDatabase} from "@al1s-wms/db";
import {buildApp} from "./app.js";

test("item create and partial update enforce shelf-life applicability",async()=>{
  const db=openDatabase(":memory:"),home=randomUUID(),user=randomUUID(),session=randomUUID();
  db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(home,"home");
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)").run(user,"test","unused",new Date().toISOString());
  db.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES (?,?,?)").run(session,user,"2099-01-01T00:00:00.000Z");
  const app=await buildApp(db),headers={cookie:`session=${session}`},url=`/api/v1/homes/${home}/items`;
  try{
    for(const consumptionType of ["consumable","non_consumable","long_term_consumable"]){
      const created=await app.inject({method:"POST",url,headers,payload:{name:consumptionType,category:"其他",baseUnit:"个",reorderPoint:0,reorderQuantity:0,consumptionType,openedShelfLifeDays:consumptionType==="long_term_consumable"?10:"bad"}});
      assert.equal(created.statusCode,201,created.body);
      const id=created.json().id;
      const value=()=>db.prepare("SELECT opened_shelf_life_days AS days FROM items WHERE id=?").get(id)!.days;
      assert.equal(value(),consumptionType==="long_term_consumable"?10:null);
      const patch=(payload:object)=>app.inject({method:"PATCH",url:`${url}/${id}`,headers,payload});
      assert.equal((await patch({name:"renamed"})).statusCode,200);
      assert.equal(value(),consumptionType==="long_term_consumable"?10:null);
      assert.equal((await patch({openedShelfLifeDays:-3})).statusCode,consumptionType==="long_term_consumable"?400:200);
      assert.equal((await patch({consumptionType:"non_consumable",openedShelfLifeDays:{forced:true}})).statusCode,200);
      assert.equal(value(),null);
      assert.equal((await patch({consumptionType:"long_term_consumable"})).statusCode,200);
      assert.equal(value(),null);
      assert.equal((await patch({openedShelfLifeDays:8})).statusCode,200);assert.equal(value(),8);
      assert.equal((await patch({consumptionType:"consumable"})).statusCode,200);assert.equal(value(),null);
      assert.equal((await patch({})).statusCode,400);
    }
  }finally{await app.close();db.close();}
});
