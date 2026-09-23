import assert from "node:assert/strict";
import {test} from "node:test";
Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>"zh-CN"}});
Object.defineProperty(globalThis,"document",{configurable:true,value:{documentElement:{lang:""}}});
const {default:i18n}=await import("./index.js");
const {apiJson:send}=await import("./apiFetch.js");

test("JSON writes retain body omission, nulls, language and raw HTTP failures",async(context)=>{
  const response=new Response('{"message":"conflict"}',{status:409});
  const requests:{input:RequestInfo|URL;init?:RequestInit}[]=[];
  context.mock.method(globalThis,"fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{requests.push({input,init});return response;});
  for(const locale of ["zh-CN","en-US"]){
    await i18n.changeLanguage(locale);
    const result=await send("/api/write","PATCH",{absent:undefined,empty:null,idempotencyKey:"same",quantity:0});
    assert.equal(result,response);assert.equal(result.bodyUsed,false);
    const request=requests.at(-1)!;
    assert.equal(request.input,"/api/write");assert.equal(request.init?.method,"PATCH");
    assert.equal(request.init?.body,'{"empty":null,"idempotencyKey":"same","quantity":0}');
    assert.equal(new Headers(request.init?.headers).get("Accept-Language"),locale);
    assert.equal(new Headers(request.init?.headers).get("content-type"),"application/json");
  }
  await i18n.changeLanguage("zh-CN");
});
test("JSON writes propagate network rejection without retry",async(context)=>{
  const error=new TypeError("network failure");let calls=0;
  context.mock.method(globalThis,"fetch",async()=>{calls++;throw error;});
  await assert.rejects(send("/api/write","POST",{}),value=>value===error);
  assert.equal(calls,1);
});
