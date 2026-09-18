import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { batchBalanceQuery, InventoryError } from "./stock.js";

const monthSchema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const financialFilters=z.object({month:monthSchema}).strict();
const money=z.number().nonnegative().finite().max(1_000_000_000);
const budgetInput=z.object({month:monthSchema,total:money.nullable(),categoryBudgets:z.array(z.object({category:z.string().trim().min(1).max(100),amount:money})).max(100)}).strict();
type MoneyRow={category:string|null;total:number};

function categoryAncestors(db:DatabaseSync,homeId:string) {
  const rows=db.prepare("SELECT id,name,parent_id AS parentId FROM item_categories WHERE home_id=?").all(homeId) as {id:string;name:string;parentId:string|null}[];
  const byId=new Map(rows.map(row=>[row.id,row]));
  return (name:string)=>{
    const names=[name],seen=new Set<string>();
    let row=rows.find(row=>row.name===name);
    while(row&&!seen.has(row.id)) {
      seen.add(row.id);
      row=row.parentId?byId.get(row.parentId):undefined;
      if(row)names.push(row.name);
    }
    return names;
  };
}

function requireHome(db:DatabaseSync,homeId:string) {
  const home=db.prepare("SELECT default_currency AS currency FROM homes WHERE id=? AND active=1").get(homeId) as {currency:string}|undefined;
  if(!home)throw new InventoryError(404,"HOME_NOT_FOUND","error.homeNotFound");
  return home;
}
function shiftMonth(month:string,offset:number) {
  const [year,value]=month.split("-").map(Number);
  const date=new Date(Date.UTC(year,value-1+offset,1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;
}
function budgetForMonth(db:DatabaseSync,homeId:string,month:string) {
  const budget=db.prepare("SELECT month,total_minor/100.0 AS total FROM finance_budgets WHERE home_id=? AND month<=? ORDER BY month DESC LIMIT 1").get(homeId,month) as {month:string;total:number}|undefined;
  if(!budget)return {total:null,sourceMonth:null,categoryBudgets:[] as {category:string;amount:number}[]};
  const categoryBudgets=db.prepare("SELECT category,amount_minor/100.0 AS amount FROM finance_category_budgets WHERE home_id=? AND month=? ORDER BY category").all(homeId,budget.month) as {category:string;amount:number}[];
  return {total:budget.total,sourceMonth:budget.month,categoryBudgets};
}
function totalsByCategory(db:DatabaseSync,homeId:string,month:string,kind:"actual"|"planned") {
  const sql=kind==="actual"
    ? "SELECT COALESCE(purchase_category,'其他') AS category,SUM(purchase_total_minor)/100.0 AS total FROM stock_batches WHERE home_id=? AND substr(purchased_date,1,7)=? AND purchase_total_minor IS NOT NULL GROUP BY COALESCE(purchase_category,'其他')"
    : "SELECT COALESCE(category,'其他') AS category,SUM(estimated_total_minor)/100.0 AS total FROM shopping_list WHERE home_id=? AND completed=0 AND substr(planned_date,1,7)=? AND estimated_total_minor IS NOT NULL GROUP BY COALESCE(category,'其他')";
  return db.prepare(sql).all(homeId,month) as MoneyRow[];
}
function mergeDistribution(actual:MoneyRow[],planned:MoneyRow[]) {
  const values=new Map<string,{category:string;actual:number;planned:number}>();
  for(const row of actual)values.set(row.category??"其他",{category:row.category??"其他",actual:row.total,planned:0});
  for(const row of planned) {const category=row.category??"其他";const value=values.get(category)??{category,actual:0,planned:0};value.planned=row.total;values.set(category,value);}
  return [...values.values()].sort((a,b)=>b.actual+b.planned-a.actual-a.planned);
}

export function saveFinancialBudget(db:DatabaseSync,homeId:string,raw:unknown) {
  const input=budgetInput.parse(raw);
  const home=requireHome(db,homeId);
  const categories=new Set<string>();
  for(const budget of input.categoryBudgets) {
    if(categories.has(budget.category))throw new InventoryError(400,"DUPLICATE_CATEGORY_BUDGET","error.validation");
    categories.add(budget.category);
  }
  const categoryTotal=input.categoryBudgets.reduce((total,budget)=>total+budget.amount,0);
  const ancestors=categoryAncestors(db,homeId);
  for(const category of categories) {
    if(ancestors(category).slice(1).some(parent=>categories.has(parent)))
      throw new InventoryError(400,"OVERLAPPING_CATEGORY_BUDGET","error.validation");
  }
  const total=input.total??(input.categoryBudgets.length?categoryTotal:null);
  if(input.total!==null&&categoryTotal>input.total+1e-9)throw new InventoryError(400,"CATEGORY_BUDGET_EXCEEDS_TOTAL","error.validation");
  db.exec("BEGIN IMMEDIATE");
  try {
    if(total===null) {
      db.prepare("DELETE FROM finance_category_budgets WHERE home_id=? AND month=?").run(homeId,input.month);
      db.prepare("DELETE FROM finance_budgets WHERE home_id=? AND month=?").run(homeId,input.month);
    } else {
      db.prepare("INSERT INTO finance_budgets(home_id,month,total_minor,currency,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(home_id,month) DO UPDATE SET total_minor=excluded.total_minor,currency=excluded.currency,updated_at=excluded.updated_at").run(homeId,input.month,Math.round(total*100),home.currency,new Date().toISOString());
      db.prepare("DELETE FROM finance_category_budgets WHERE home_id=? AND month=?").run(homeId,input.month);
      const insert=db.prepare("INSERT INTO finance_category_budgets(home_id,month,category,amount_minor) VALUES (?,?,?,?)");
      for(const budget of input.categoryBudgets)insert.run(homeId,input.month,budget.category,Math.round(budget.amount*100));
    }
    db.exec("COMMIT");
  } catch(error) {db.exec("ROLLBACK");throw error;}
  return financialDashboard(db,homeId,{month:input.month});
}

export function financialDashboard(db:DatabaseSync,homeId:string,raw:unknown) {
  const {month}=financialFilters.parse(raw);
  const home=requireHome(db,homeId);
  const actual=(db.prepare("SELECT COALESCE(SUM(purchase_total_minor),0)/100.0 AS total FROM stock_batches WHERE home_id=? AND substr(purchased_date,1,7)=? AND purchase_total_minor IS NOT NULL").get(homeId,month) as {total:number}).total;
  const planned=(db.prepare("SELECT COALESCE(SUM(estimated_total_minor),0)/100.0 AS total FROM shopping_list WHERE home_id=? AND completed=0 AND substr(planned_date,1,7)=? AND estimated_total_minor IS NOT NULL").get(homeId,month) as {total:number}).total;
  const budget=budgetForMonth(db,homeId,month);
  const categoryBudgets=budget.categoryBudgets;
  const actualByCategory=totalsByCategory(db,homeId,month,"actual");
  const plannedByCategory=totalsByCategory(db,homeId,month,"planned");
  const ancestors=categoryAncestors(db,homeId);
  const budgetNames=new Set(categoryBudgets.map(row=>row.category));
  const rollup=(rows:MoneyRow[])=>{
    const totals=new Map<string,number>();
    for(const row of rows) {
      const path=ancestors(row.category??"其他");
      // The outermost budget owns the whole subtree, including legacy overlaps.
      const category=[...path].reverse().find(name=>budgetNames.has(name))??path[0];
      totals.set(category,(totals.get(category)??0)+row.total);
    }
    return [...totals].map(([category,total])=>({category,total}));
  };
  const categoryDistribution=mergeDistribution(rollup(actualByCategory),rollup(plannedByCategory));
  for(const categoryBudget of categoryBudgets)if(!categoryDistribution.some(row=>row.category===categoryBudget.category))categoryDistribution.push({category:categoryBudget.category,actual:0,planned:0});
  const byCategory=categoryDistribution.map(row=>({...row,budget:categoryBudgets.find(budget=>budget.category===row.category)?.amount??null})).sort((left,right)=>(right.actual+right.planned)-(left.actual+left.planned)||left.category.localeCompare(right.category));
  const byChannel=db.prepare("SELECT b.channel_id AS channelId,COALESCE(c.name,'未指定') AS channelName,SUM(b.purchase_total_minor)/100.0 AS total FROM stock_batches b LEFT JOIN shopping_channels c ON c.id=b.channel_id WHERE b.home_id=? AND substr(b.purchased_date,1,7)=? AND b.purchase_total_minor IS NOT NULL GROUP BY b.channel_id,c.name ORDER BY total DESC").all(homeId,month);
  const purchases=db.prepare(`SELECT b.id AS batchId,b.item_id AS itemId,i.name AS itemName,COALESCE(b.purchase_category,i.category) AS category,b.purchased_date AS purchaseDate,b.purchase_total_minor/100.0 AS totalPrice,b.purchase_currency AS currency,b.channel_id AS channelId,COALESCE(c.name,'未指定') AS channelName,b.shopping_item_id AS shoppingItemId,s.estimated_total_minor/100.0 AS estimatedTotal,
    COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.batch_id=b.id AND t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%'),0) AS quantity
    FROM stock_batches b JOIN items i ON i.id=b.item_id LEFT JOIN shopping_channels c ON c.id=b.channel_id LEFT JOIN shopping_list s ON s.id=b.shopping_item_id
    WHERE b.home_id=? AND substr(b.purchased_date,1,7)=? AND b.purchase_total_minor IS NOT NULL ORDER BY b.purchased_date DESC,b.received_at DESC LIMIT 200`).all(homeId,month) as {batchId:string;quantity:number;totalPrice:number;estimatedTotal:number|null}[];
  const purchaseRecords=purchases.map(row=>({...row,unitPrice:row.quantity>0?Math.round(row.totalPrice/row.quantity*100)/100:null,variance:row.estimatedTotal==null?null:Math.round((row.totalPrice-row.estimatedTotal)*100)/100}));
  const valueRows=db.prepare(`SELECT * FROM (${batchBalanceQuery}) WHERE homeId=? AND quantity>0`).all(homeId) as {batchId:string;itemId:string;itemName:string;itemCategory:string;baseUnit:string;locationId:string|null;locationName:string|null;quantity:number;initialQuantity:number;purchaseTotalMinor:number|null;purchaseCategory:string|null}[];
  const known=new Set<string>(),unknown=new Set<string>();let inventoryValue=0;
  const valuationByItem=new Map<string,{itemId:string;itemName:string;category:string;quantity:number;unit:string;locationIds:Set<string>;value:number}>();
  const valuationByCategory=new Map<string,{category:string;value:number}>();
  const valuationByLocation=new Map<string,{locationId:string|null;locationName:string;value:number}>();
  for(const row of valueRows) {
    if(row.purchaseTotalMinor===null||row.initialQuantity<=0) {unknown.add(row.batchId);continue;}
    known.add(row.batchId);const value=row.purchaseTotalMinor/100*row.quantity/row.initialQuantity;inventoryValue+=value;
    const category=row.purchaseCategory??row.itemCategory;
    const item=valuationByItem.get(row.itemId)??{itemId:row.itemId,itemName:row.itemName,category,quantity:0,unit:row.baseUnit,locationIds:new Set<string>(),value:0};item.quantity+=row.quantity;item.value+=value;if(row.locationId)item.locationIds.add(row.locationId);valuationByItem.set(row.itemId,item);
    const categoryValue=valuationByCategory.get(category)??{category,value:0};categoryValue.value+=value;valuationByCategory.set(category,categoryValue);
    const locationKey=row.locationId??"";const locationValue=valuationByLocation.get(locationKey)??{locationId:row.locationId,locationName:row.locationName??"未指定",value:0};locationValue.value+=value;valuationByLocation.set(locationKey,locationValue);
  }
  const trend=[];
  for(let offset=-11;offset<=0;offset++) {
    const point=shiftMonth(month,offset);
    const spent=(db.prepare("SELECT COALESCE(SUM(purchase_total_minor),0)/100.0 AS total FROM stock_batches WHERE home_id=? AND substr(purchased_date,1,7)=? AND purchase_total_minor IS NOT NULL").get(homeId,point) as {total:number}).total;
    const pending=(db.prepare("SELECT COALESCE(SUM(estimated_total_minor),0)/100.0 AS total FROM shopping_list WHERE home_id=? AND completed=0 AND substr(planned_date,1,7)=? AND estimated_total_minor IS NOT NULL").get(homeId,point) as {total:number}).total;
    const limit=budgetForMonth(db,homeId,point);
    trend.push({month:point,actual:spent,planned:pending,budget:limit.total});
  }
  const forecast=actual+planned;
  return {month,currency:home.currency,budgetTotal:budget.total,budgetSourceMonth:budget.sourceMonth,budgetMode:budget.sourceMonth===null?"none":budget.sourceMonth===month?"explicit":"inherited",categoryBudgets,spendingTotal:actual,estimatedTotal:planned,forecastTotal:forecast,remainingBudget:budget.total===null?null:Math.round((budget.total-forecast)*100)/100,variance:actual-planned,inventoryValue:Math.round(inventoryValue*100)/100,pricedBatchCount:known.size,unknownBatchCount:unknown.size,byCategory,byChannel,purchases:purchaseRecords,trend,valuation:{byItem:[...valuationByItem.values()].map(({locationIds,...row})=>({...row,locationCount:locationIds.size})).sort((a,b)=>b.value-a.value),byCategory:[...valuationByCategory.values()].sort((a,b)=>b.value-a.value),byLocation:[...valuationByLocation.values()].sort((a,b)=>b.value-a.value)}};
}

export const financialSummary=financialDashboard;

export function itemPriceHistory(db:DatabaseSync,homeId:string,itemId:string) {
  if(!db.prepare("SELECT 1 FROM items WHERE id=? AND home_id=? AND active=1").get(itemId,homeId))throw new InventoryError(404,"ITEM_NOT_FOUND","error.itemNotFoundOrDeleted");
  const items=db.prepare(`SELECT b.id AS batchId,b.purchased_date AS purchaseDate,b.channel_id AS channelId,c.name AS channelName,b.purchase_currency AS currency,b.purchase_total_minor/100.0 AS totalPrice,COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.batch_id=b.id AND t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%'),0) AS quantity FROM stock_batches b LEFT JOIN shopping_channels c ON c.id=b.channel_id WHERE b.home_id=? AND b.item_id=? AND b.purchase_total_minor IS NOT NULL ORDER BY b.purchased_date DESC,b.received_at DESC`).all(homeId,itemId) as {batchId:string;purchaseDate:string|null;channelId:string|null;channelName:string|null;currency:string;totalPrice:number;quantity:number}[];
  return {itemId,items:items.map(item=>({...item,unitPrice:item.quantity>0?Math.round(item.totalPrice/item.quantity*100)/100:null}))};
}
