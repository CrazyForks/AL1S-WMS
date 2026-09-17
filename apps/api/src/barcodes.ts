import type { DatabaseSync } from "node:sqlite";
import { barcodeSchema } from "@family-erp/contracts";
import { InventoryError } from "./stock.js";

type Fetcher = typeof fetch;
type CatalogRow = {
  barcode:string;found:number;name:string|null;brand:string|null;category:string|null;
  baseUnit:string|null;imageUrl:string|null;provider:string|null;fetchedAt:string;
};

const providers=[
  {id:"open-food-facts",domain:"world.openfoodfacts.org",fallbackCategory:"食品"},
  {id:"open-beauty-facts",domain:"world.openbeautyfacts.org",fallbackCategory:"日用品"},
  {id:"open-pet-food-facts",domain:"world.openpetfoodfacts.org",fallbackCategory:"宠物用品"},
  {id:"open-products-facts",domain:"world.openproductsfacts.org",fallbackCategory:"其他"},
] as const;

export function normalizeBarcode(raw:string) {
  const barcode=barcodeSchema.parse(raw.replace(/[\s-]/g,""));
  const digits=[...barcode].map(Number);
  const expected=digits.pop()!;
  let sum=0,weight=3;
  for(let index=digits.length-1;index>=0;index--){sum+=digits[index]*weight;weight=weight===3?1:3;}
  if((10-sum%10)%10!==expected)throw new InventoryError(400,"INVALID_BARCODE_CHECKSUM","error.invalidBarcodeChecksum");
  return barcode;
}

function categoryFor(db:DatabaseSync,homeId:string,suggested:string|null,provider:string|null) {
  const names=new Set((db.prepare("SELECT name FROM item_categories WHERE home_id=? AND active=1").all(homeId) as {name:string}[]).map(row=>row.name));
  if(suggested&&names.has(suggested))return suggested;
  const fallback=provider==="open-food-facts"?"食品":provider==="open-beauty-facts"?"日用品":provider==="open-pet-food-facts"?"宠物用品":"其他";
  if(names.has(fallback))return fallback;
  return names.has("其他")?"其他":[...names][0]??"其他";
}

function responseProduct(db:DatabaseSync,homeId:string,row:CatalogRow) {
  return {
    barcode:row.barcode,name:row.name,brand:row.brand,
    category:categoryFor(db,homeId,row.category,row.provider),baseUnit:row.baseUnit??"个",
    imageUrl:row.imageUrl,provider:row.provider,
  };
}

function inferCategory(provider:{fallbackCategory:string},text:string) {
  if(/beverage|drink|water|tea|coffee|soda|juice|饮料|饮品|茶|咖啡|水/i.test(text))return "饮品";
  if(/beauty|cosmetic|clean|hygiene|shampoo|soap|清洁|洗护|美妆|日用/i.test(text))return "日用品";
  if(/pet|cat|dog|宠物|猫粮|狗粮/i.test(text))return "宠物用品";
  return provider.fallbackCategory;
}

function inferUnit(text:string) {
  if(/beverage|drink|water|tea|coffee|soda|juice|bottle|饮料|饮品|茶|咖啡|水|瓶/i.test(text))return "瓶";
  if(/box|carton|盒/i.test(text))return "盒";
  if(/bag|packet|snack|袋|包/i.test(text))return "包";
  return "个";
}

export async function lookupBarcode(db:DatabaseSync,homeId:string,raw:string,fetcher:Fetcher=fetch) {
  const barcode=normalizeBarcode(raw);
  const item=db.prepare("SELECT i.icon,i.id,i.home_id AS homeId,i.sku,i.barcode,i.name,i.category,i.base_unit AS baseUnit,i.reorder_point AS reorderPoint,i.reorder_quantity AS reorderQuantity,i.default_location_id AS locationId,l.name AS locationName,i.manufactured_date AS manufacturedDate,i.expiry_date AS expiryDate,i.active FROM items i LEFT JOIN locations l ON l.id=i.default_location_id WHERE i.home_id=? AND i.barcode=? AND i.active=1").get(homeId,barcode);
  if(item)return {found:true,source:"inventory",barcode,item};
  const cached=db.prepare("SELECT barcode,found,name,brand,category,base_unit AS baseUnit,image_url AS imageUrl,provider,fetched_at AS fetchedAt FROM barcode_catalog WHERE barcode=?").get(barcode) as CatalogRow|undefined;
  if(cached?.found)return {found:true,source:"cache",barcode,product:responseProduct(db,homeId,cached)};
  if(cached&&Date.now()-Date.parse(cached.fetchedAt)<86400000)return {found:false,source:"cache",barcode,product:null};

  let completed=0;
  if(barcode.startsWith("69")&&barcode.length<=13) {
    try {
      const apiKey=process.env.APIZERO_API_KEY?.trim();
      const response=await fetcher(`https://v1.apizero.cn/api/barcode-lookup?barcode=${barcode}`,{
        headers:{"Accept":"application/json","User-Agent":process.env.BARCODE_USER_AGENT??"AL1S-ERP/1.0 (https://github.com/RicterZ/AL1S-ERP)",...(apiKey?{"Authorization":`Bearer ${apiKey}`}:{})},
        signal:AbortSignal.timeout(4000),
      });
      if(response.ok) {
        const payload=await response.json() as {code?:number;data?:{found?:boolean;name?:string|null;brand?:string|null;manufacturer?:string|null;spec?:string|null;category?:string|null;description?:string|null}};
        if(payload.code===0) {
          completed++;
          const product=payload.data;
          const name=String(product?.name||"").trim().slice(0,200);
          if(product?.found&&name) {
            const brand=String(product.brand||"").trim().slice(0,200)||null;
            const text=`${name} ${brand??""} ${product.category??""} ${product.spec??""} ${product.description??""}`;
            const row:CatalogRow={barcode,found:1,name,brand,category:inferCategory({fallbackCategory:"其他"},text),baseUnit:inferUnit(text),imageUrl:null,provider:"apizero",fetchedAt:new Date().toISOString()};
            db.prepare("INSERT INTO barcode_catalog(barcode,found,name,brand,category,base_unit,image_url,provider,fetched_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(barcode) DO UPDATE SET found=excluded.found,name=excluded.name,brand=excluded.brand,category=excluded.category,base_unit=excluded.base_unit,image_url=excluded.image_url,provider=excluded.provider,fetched_at=excluded.fetched_at").run(row.barcode,row.found,row.name,row.brand,row.category,row.baseUnit,row.imageUrl,row.provider,row.fetchedAt);
            return {found:true,source:"online",barcode,product:responseProduct(db,homeId,row)};
          }
        }
      }
    } catch {
      // Fall through to Open Facts; an unavailable domestic lookup is not cached.
    }
  }
  for(const provider of providers) {
    try {
      const fields="code,product_name,product_name_zh,brands,categories,categories_tags,image_front_url,quantity";
      const response=await fetcher(`https://${provider.domain}/api/v2/product/${barcode}.json?fields=${fields}`,{
        headers:{"Accept":"application/json","User-Agent":process.env.BARCODE_USER_AGENT??"AL1S-ERP/1.0 (https://github.com/RicterZ/AL1S-ERP)"},
        signal:AbortSignal.timeout(4000),
      });
      if(response.status===404){completed++;continue;}
      if(!response.ok)continue;
      completed++;
      const data=await response.json() as {status?:number;product?:Record<string,unknown>};
      const product=data.product??{};
      const name=String(product.product_name_zh||product.product_name||"").trim();
      if(data.status!==1||!name)continue;
      const brand=String(product.brands||"").trim()||null;
      const categories=Array.isArray(product.categories_tags)?product.categories_tags.join(" "):String(product.categories||"");
      const text=`${name} ${brand??""} ${categories} ${product.quantity??""}`;
      const row:CatalogRow={barcode,found:1,name,brand,category:inferCategory(provider,text),baseUnit:inferUnit(text),imageUrl:String(product.image_front_url||"").trim()||null,provider:provider.id,fetchedAt:new Date().toISOString()};
      db.prepare("INSERT INTO barcode_catalog(barcode,found,name,brand,category,base_unit,image_url,provider,fetched_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(barcode) DO UPDATE SET found=excluded.found,name=excluded.name,brand=excluded.brand,category=excluded.category,base_unit=excluded.base_unit,image_url=excluded.image_url,provider=excluded.provider,fetched_at=excluded.fetched_at").run(row.barcode,row.found,row.name,row.brand,row.category,row.baseUnit,row.imageUrl,row.provider,row.fetchedAt);
      return {found:true,source:"online",barcode,product:responseProduct(db,homeId,row)};
    } catch {
      // Try the next Open Facts database. Failed lookups are not cached.
    }
  }
  const expectedCompleted=providers.length+(barcode.startsWith("69")&&barcode.length<=13?1:0);
  if(completed!==expectedCompleted)throw new InventoryError(503,"BARCODE_LOOKUP_UNAVAILABLE","error.barcodeLookupUnavailable");
  db.prepare("INSERT INTO barcode_catalog(barcode,found,fetched_at) VALUES (?,0,?) ON CONFLICT(barcode) DO UPDATE SET found=0,name=NULL,brand=NULL,category=NULL,base_unit=NULL,image_url=NULL,provider=NULL,fetched_at=excluded.fetched_at").run(barcode,new Date().toISOString());
  return {found:false,source:"online",barcode,product:null};
}
