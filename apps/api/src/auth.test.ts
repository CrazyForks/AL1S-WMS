import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {test} from "node:test";
import {openDatabase} from "@al1s-wms/db";
import {buildApp} from "./app.js";

test("REST sessions precede token scope while MCP requires a token",async()=>{
  const db=openDatabase(":memory:");
  const home=randomUUID(),other=randomUUID(),user=randomUUID(),session=randomUUID();
  const token=`al1s_${randomUUID().replaceAll("-","")}`;
  db.prepare("INSERT INTO homes(id,name) VALUES (?,?),(?,?)").run(home,"Home",other,"Other");
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)").run(user,"tester","unused",new Date().toISOString());
  db.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES (?,?,?)").run(session,user,"2099-01-01T00:00:00.000Z");
  db.prepare("INSERT INTO api_tokens(id,user_id,home_id,name,token_hash,token_prefix,created_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),user,home,"token",createHash("sha256").update(token).digest("hex"),token.slice(0,13),new Date().toISOString());
  const app=await buildApp(db);
  try{
    const url=`/api/v1/homes/${other}/items`;
    const authorization=`Bearer ${token}`,cookie=`session=${session}`;
    assert.equal((await app.inject({url,headers:{authorization}})).statusCode,403);
    assert.equal((await app.inject({url,headers:{authorization,cookie}})).statusCode,200);
    assert.equal((await app.inject({url,headers:{cookie}})).statusCode,200);
    assert.equal((await app.inject({url,headers:{cookie:"session=missing",authorization}})).statusCode,403);
    assert.equal((await app.inject({url,headers:{authorization:"Bearer invalid"}})).statusCode,401);
    assert.equal((await app.inject({url:"/api/v1/auth/me",headers:{authorization}})).statusCode,401);
    const mcp=await app.inject({method:"POST",url:"/mcp",headers:{cookie},payload:{}});
    assert.equal(mcp.statusCode,401);assert.equal(mcp.json().code,"INVALID_API_TOKEN");
    db.prepare("UPDATE sessions SET expires_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z",session);
    assert.equal((await app.inject({url,headers:{cookie}})).statusCode,401);
  }finally{await app.close();db.close();}
});
