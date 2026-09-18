import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase } from "@al1s-wms/db";
import { lookupBarcode, normalizeBarcode } from "./barcodes.js";
import { InventoryError } from "./stock.js";

function fixture() {
  const db=openDatabase(":memory:"),homeId=randomUUID();
  db.prepare("INSERT INTO homes(id,name) VALUES (?,?)").run(homeId,"测试家庭");
  db.prepare("INSERT INTO item_categories(id,home_id,name) VALUES (?,?,?),(?,?,?)").run(randomUUID(),homeId,"食品",randomUUID(),homeId,"其他");
  return {db,homeId};
}

test("barcode lookup returns household inventory before cache or network",async()=>{
  const {db,homeId}=fixture(),itemId=randomUUID(),barcode="3017620422003";
  db.prepare("INSERT INTO items(id,home_id,sku,barcode,name,category,base_unit) VALUES (?,?,?,?,?,?,?)").run(itemId,homeId,itemId,barcode,"本地商品","食品","个");
  let calls=0;
  const result=await lookupBarcode(db,homeId,barcode,async()=>{calls++;throw new Error("network must not run");});
  assert.equal(result.source,"inventory");
  assert.equal(result.item?.id,itemId);
  assert.equal(calls,0);
  db.close();
});

test("online barcode metadata is normalized and cached locally",async()=>{
  const {db,homeId}=fixture(),barcode="3017620422003";
  let calls=0;
  const fetcher:typeof fetch=async()=>{calls++;return new Response(JSON.stringify({status:1,product:{product_name:"Sparkling Water",brands:"Example",categories:"Beverages",quantity:"500 ml",image_front_url:"https://example.com/product.jpg"}}),{status:200});};
  const online=await lookupBarcode(db,homeId,barcode,fetcher);
  assert.equal(online.source,"online");
  assert.equal(online.product?.name,"Sparkling Water");
  assert.equal(online.product?.category,"食品","food products fall back to the household food category");
  assert.equal(online.product?.baseUnit,"瓶");
  const cached=await lookupBarcode(db,homeId,barcode,async()=>{throw new Error("cache must prevent network");});
  assert.equal(cached.source,"cache");
  assert.equal(calls,1);
  db.close();
});

test("barcode providers fall back and misses use a short negative cache",async()=>{
  const {db,homeId}=fixture(),barcode="4006381333931";
  let calls=0;
  const fallback:typeof fetch=async url=>{
    calls++;
    return new Response(JSON.stringify(String(url).includes("openbeautyfacts")?{status:1,product:{product_name:"Hand Soap"}}:{status:0}),{status:200});
  };
  const beauty=await lookupBarcode(db,homeId,barcode,fallback);
  assert.equal(beauty.product?.provider,"open-beauty-facts");
  assert.equal(calls,2);

  const missingBarcode="12345670";
  calls=0;
  const miss:typeof fetch=async()=>{calls++;return new Response(JSON.stringify({status:0}),{status:200});};
  assert.equal((await lookupBarcode(db,homeId,missingBarcode,miss)).found,false);
  assert.equal(calls,4);
  assert.equal((await lookupBarcode(db,homeId,missingBarcode,async()=>{throw new Error("negative cache must prevent network");})).source,"cache");
  db.close();
});

test("Chinese barcodes prefer ApiZero and optionally send its API key",async()=>{
  const {db,homeId}=fixture(),barcode="6946852340434";
  process.env.APIZERO_API_KEY="sk_test_example";
  let calls=0;
  const fetcher:typeof fetch=async(input,init)=>{
    calls++;
    assert.equal(String(input),`https://v1.apizero.cn/api/barcode-lookup?barcode=${barcode}`);
    assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer sk_test_example");
    return new Response(JSON.stringify({code:0,data:{barcode,found:true,name:"示例国内商品",brand:"示例品牌",category:"日用品",spec:"100毫升"}}),{status:200});
  };
  try {
    const result=await lookupBarcode(db,homeId,barcode,fetcher);
    assert.equal(result.product?.provider,"apizero");
    assert.equal(result.product?.name,"示例国内商品");
    assert.equal(calls,1);
  } finally {
    delete process.env.APIZERO_API_KEY;
    db.close();
  }
});

test("barcode checksum is validated",()=>{
  assert.equal(normalizeBarcode("3017 6204-22003"),"3017620422003");
  assert.throws(()=>normalizeBarcode("3017620422004"),(error:unknown)=>error instanceof InventoryError&&error.code==="INVALID_BARCODE_CHECKSUM");
});
