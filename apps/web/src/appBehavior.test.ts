import assert from "node:assert/strict";
import {test} from "node:test";
import * as navigation from "./navigation.js";
import * as dates from "./displayDates.js";



const paths={home:"/",count:"/count",shopping:"/shopping",finance:"/finance",locations:"/locations",categories:"/categories",profile:"/profile"};
test("navigation preserves trailing slash, unknown path and detail source behavior",(context)=>{
  const browser={location:{pathname:"/"},history:{state:null as null|{itemDetailSource:unknown}}};
  const original=Object.getOwnPropertyDescriptor(globalThis,"window");
  Object.defineProperty(globalThis,"window",{configurable:true,value:browser});
  context.after(()=>{if(original)Object.defineProperty(globalThis,"window",original);else Reflect.deleteProperty(globalThis,"window");});
  const api=navigation;
  for(const [page,path] of Object.entries(paths)){
    browser.location.pathname=path+"///";
    assert.equal(api.pageFromUrl(),page);
  }
  browser.location.pathname="/unknown";
  assert.equal(api.pageFromUrl(),"home");
  const id="ABCDEF12-1234-1234-1234-123456789ABC";
  browser.location.pathname=`/items/${id}/`;
  assert.equal(api.itemDetailIdFromUrl(),id);
  browser.location.pathname="/items/not-an-id";
  assert.equal(api.itemDetailIdFromUrl(),null);
  for(const source of [null,{}, {itemDetailSource:"unknown"},{itemDetailSource:12}]){
    browser.history.state=source as typeof browser.history.state;
    assert.equal(api.itemDetailSourcePage(),null);
  }
  browser.history.state={itemDetailSource:"finance"};
  assert.equal(api.itemDetailSourcePage(),"finance");
});
test("opened expiry ignores invalid values and compares date-only values at local end of day",()=>{
  const api=dates;
  assert.equal(api.formatDateTime("invalid"),"invalid");
  assert.equal(api.formatDateTime("2026-09-02T03:04:00"),"2026-09-02 03:04");
  assert.equal(api.openedExpiryForDisplay({openedExpiryDate:null,expiryDate:null}),null);
  assert.equal(api.openedExpiryForDisplay({openedExpiryDate:"invalid",expiryDate:"2026-09-02"}),"2026-09-02");
  assert.equal(api.openedExpiryForDisplay({openedExpiryDate:"2026-09-02T12:00:00",expiryDate:"2026-09-02"}),"2026-09-02 12:00");
  assert.equal(api.openedExpiryForDisplay({openedExpiryDate:"2026-09-03T12:00:00",expiryDate:"2026-09-02"}),"2026-09-02");
});
test("read requests preserve paths, paging, snapshot encoding and endpoint errors",async(context)=>{

  let path="",fail=false;
  const data={sentinel:true};
  const original=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>"home"}});
  context.after(()=>{if(original)Object.defineProperty(globalThis,"localStorage",original);else Reflect.deleteProperty(globalThis,"localStorage");});
  context.mock.method(globalThis,"fetch",async (url:RequestInfo|URL)=>{path=String(url);return new Response(JSON.stringify(data),{status:fail?400:200});});
  const originalDocument=Object.getOwnPropertyDescriptor(globalThis,"document");
  Object.defineProperty(globalThis,"document",{configurable:true,value:{documentElement:{lang:""}}});
  context.after(()=>{if(originalDocument)Object.defineProperty(globalThis,"document",originalDocument);else Reflect.deleteProperty(globalThis,"document");});
  const client=await import("./apiClient.js");
  const {default:i18n}=await import("./i18n/index.js");
  await i18n.changeLanguage("zh-CN");
  const api=client;
  const cases:[keyof Pick<typeof client,"getItems"|"getStock"|"getOpenedConsumables"|"getLocations"|"getTransactions"|"getShoppingList"|"getShoppingChannels"|"getShoppingCalendar"|"getFinancialSummary"|"getCategories">,string,string,unknown[]][]=[
    ["getItems","items","无法加载物资",[]], ["getStock","stock","无法加载库存",[]],
    ["getOpenedConsumables","opened-consumables","无法加载已开封消耗品",[]], ["getLocations","locations","无法加载地点",[]],
    ["getTransactions","transactions?limit=10&offset=0","无法加载变动记录",[]],
    ["getShoppingList","shopping-list","无法加载采购清单",[]], ["getShoppingChannels","shopping-channels","无法加载购买渠道",[]],
    ["getShoppingCalendar","shopping-calendar?month=2026-09&includeCompleted=false","无法加载采购日历",["2026-09"]],
    ["getFinancialSummary","financial-dashboard?month=2026-09","无法加载财务数据",["2026-09"]], ["getCategories","categories","无法加载物资类型",[]],
  ];
  for(const [name,suffix,error,args] of cases){
    fail=false;assert.deepEqual(await (api[name] as (...args:unknown[])=>Promise<unknown>)(...args),data);assert.equal(path,`/api/v1/homes/home/${suffix}`);
    fail=true;await assert.rejects((api[name] as (...args:unknown[])=>Promise<unknown>)(...args),{message:error});
  }
  fail=false;
  await api.getTransactions(3,"2026-09-01T00:00:00+08:00",20);
  assert.equal(path,"/api/v1/homes/home/transactions?limit=20&offset=40&snapshotAt=2026-09-01T00%3A00%3A00%2B08%3A00");
});
