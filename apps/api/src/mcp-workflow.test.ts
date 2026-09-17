import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openDatabase } from "@family-erp/db";
import { buildApp } from "./app.js";
import { createMcpServer } from "./mcp.js";

const parseTool = (result:unknown) =>
  JSON.parse(((result as {content:{type:string;text:string}[]}).content)[0].text);

test("home-scoped tokens isolate REST and simplify MCP tool inputs", async () => {
  process.env.NODE_ENV="test";
  const db=openDatabase(":memory:");
  const homeId=randomUUID(),otherHomeId=randomUUID(),locationId=randomUUID(),itemId=randomUUID(),userId=randomUUID();
  db.prepare("INSERT INTO homes(id,name) VALUES (?,?),(?,?)").run(homeId,"本家",otherHomeId,"其他家");
  db.prepare("INSERT INTO locations(id,home_id,name) VALUES (?,?,?)").run(locationId,homeId,"储物柜");
  db.prepare("INSERT INTO items(id,home_id,sku,name,category,base_unit,reorder_point,default_location_id) VALUES (?,?,?,?,?,?,?,?)").run(itemId,homeId,itemId,"牛奶","食品","瓶",3,locationId);
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES (?,?,?,?)").run(userId,randomUUID(),"test",new Date().toISOString());
  const sessionId=randomUUID();
  db.prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES (?,?,?)").run(sessionId,userId,new Date(Date.now()+86400000).toISOString());
  const addToken=(home:string|null) => {
    const token=`al1s_${randomUUID().replaceAll("-","")}${randomUUID().replaceAll("-","")}`;
    db.prepare("INSERT INTO api_tokens(id,user_id,home_id,name,token_hash,token_prefix,created_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),userId,home,"test",createHash("sha256").update(token).digest("hex"),token.slice(0,13),new Date().toISOString());
    return token;
  };
  const homeToken=addToken(homeId),accountToken=addToken(null);
  const app=await buildApp(db);
  const request=async(token:string,method:"GET"|"POST"|"PATCH"|"DELETE",url:string,body?:Record<string,unknown>)=>{
    const response=await app.inject({method,url,headers:{authorization:`Bearer ${token}`},payload:body});
    return {status:response.statusCode,body:response.json()};
  };
  assert.equal((await request(homeToken,"GET",`/api/v1/homes/${homeId}/items`)).status,200);
  assert.equal((await request(homeToken,"GET",`/api/v1/homes/${otherHomeId}/items`)).status,403);
  assert.equal(((await request(homeToken,"GET","/api/v1/homes")).body as unknown[]).length,1);
  assert.equal(((await request(accountToken,"GET","/api/v1/homes")).body as unknown[]).length,2);
  const createdToken=await app.inject({method:"POST",url:"/api/v1/auth/tokens",headers:{cookie:`session=${sessionId}`},payload:{name:"家庭 Agent",homeId}});
  assert.equal(createdToken.statusCode,201);
  assert.equal(db.prepare("SELECT home_id FROM api_tokens WHERE id=?").get(createdToken.json().id)?.home_id,homeId);
  const missingScope=await app.inject({method:"POST",url:"/api/v1/auth/tokens",headers:{cookie:`session=${sessionId}`},payload:{name:"无范围"}});
  assert.equal(missingScope.statusCode,400);

  const server=createMcpServer((method,url,body)=>request(homeToken,method,url,body),homeId);
  const client=new Client({name:"workflow-test",version:"1"});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);await client.connect(clientTransport);
  const tools=await client.listTools();
  const receipt=tools.tools.find(tool=>tool.name==="record_receipt")!;
  assert.equal("homeId" in (receipt.inputSchema.properties??{}),false);
  assert.equal("reason" in (receipt.inputSchema.properties??{}),false);
  assert.equal("reason" in (tools.tools.find(tool=>tool.name==="transfer_stock")!.inputSchema.properties??{}),false);
  const context=parseTool(await client.callTool({name:"get_home_context",arguments:{}}));
  assert.equal(context.scope,"home");
  assert.equal(context.currentHome.id,homeId);
  const guide=parseTool(await client.callTool({name:"get_agent_guide",arguments:{}}));
  assert.equal(guide.receipt.length,4);
  const received=parseTool(await client.callTool({name:"record_receipt",arguments:{itemId,locationId,quantity:2,idempotencyKey:"mcp-receipt",expiryDate:"2027-01-01"}}));
  assert.equal(received.beforeQuantity,0);
  assert.equal(received.afterQuantity,2);
  const overview=parseTool(await client.callTool({name:"get_home_overview",arguments:{}}));
  assert.equal(overview.needsReplenishment.total,1);
  await client.close();await server.close();

  const accountServer=createMcpServer((method,url,body)=>request(accountToken,method,url,body));
  const accountClient=new Client({name:"account-test",version:"1"});
  const [accountClientTransport,accountServerTransport]=InMemoryTransport.createLinkedPair();
  await accountServer.connect(accountServerTransport);await accountClient.connect(accountClientTransport);
  const accountTools=await accountClient.listTools();
  assert.equal("homeId" in (accountTools.tools.find(tool=>tool.name==="record_receipt")!.inputSchema.properties??{}),true);
  await accountClient.close();await accountServer.close();await app.close();db.close();
});
