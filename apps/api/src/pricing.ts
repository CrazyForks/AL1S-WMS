import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { InventoryError } from "./stock.js";

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
function monthRange(month:string) {
  return [`${month}-01`,`${shiftMonth(month,1)}-01`] as const;
}
function dayAfter(date:string) {
  const next=new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate()+1);
  return next.toISOString().slice(0,10);
}

const dateSchema=z.string().date();
const purchaseFilters=z.object({start:dateSchema,end:dateSchema,page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).strict().refine(value=>value.start<=value.end,{message:"Invalid date range"});
export function listPurchaseRecords(db:DatabaseSync,homeId:string,raw:unknown){
  const input=purchaseFilters.parse(raw);
  const home=requireHome(db,homeId);
  const from=`${input.start}T00:00:00.000Z`,until=`${dayAfter(input.end)}T00:00:00.000Z`;
  const totals=db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(purchase_total_minor),0)/100.0 AS amount FROM stock_batches WHERE home_id=? AND received_at>=? AND received_at<? AND purchase_total_minor IS NOT NULL").get(homeId,from,until) as {total:number;amount:number};
  const totalPages=Math.max(1,Math.ceil(totals.total/input.pageSize)),page=Math.min(input.page,totalPages);
  const rows=db.prepare(`SELECT b.id AS batchId,b.item_id AS itemId,i.name AS itemName,COALESCE(b.purchase_category,i.category) AS category,substr(b.received_at,1,10) AS receivedDate,b.purchased_date AS purchaseDate,b.purchase_total_minor/100.0 AS totalPrice,COALESCE(c.name,'未指定') AS channelName,s.estimated_total_minor/100.0 AS estimatedTotal,
    COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.batch_id=b.id AND t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%'),0) AS quantity
    FROM stock_batches b JOIN items i ON i.id=b.item_id LEFT JOIN shopping_channels c ON c.id=b.channel_id LEFT JOIN shopping_list s ON s.id=b.shopping_item_id
    WHERE b.home_id=? AND b.received_at>=? AND b.received_at<? AND b.purchase_total_minor IS NOT NULL ORDER BY b.received_at DESC,b.id DESC LIMIT ? OFFSET ?`).all(homeId,from,until,input.pageSize,(page-1)*input.pageSize) as {batchId:string;itemId:string;itemName:string;category:string;receivedDate:string;purchaseDate:string|null;totalPrice:number;channelName:string;estimatedTotal:number|null;quantity:number}[];
  return {...input,page,totalPages,total:totals.total,amount:totals.amount,currency:home.currency,items:rows.map(row=>({...row,unitPrice:row.quantity>0?Math.round(row.totalPrice/row.quantity*100)/100:null,variance:row.estimatedTotal===null?null:Math.round((row.totalPrice-row.estimatedTotal)*100)/100}))};
}

function monthEnd(month:string){return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);}
function shiftDate(date:string,offset:number){const month=shiftMonth(date.slice(0,7),offset);return `${month}-${String(Math.min(Number(date.slice(8)),Number(monthEnd(month).slice(8)))).padStart(2,"0")}`;}
function shiftDay(date:string,offset:number){const value=new Date(`${date}T00:00:00.000Z`);value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10);}
function shiftYear(date:string,offset:number){const value=new Date(`${date}T00:00:00.000Z`);value.setUTCFullYear(value.getUTCFullYear()+offset);return value.toISOString().slice(0,10);}
export function financialTrend(db:DatabaseSync,homeId:string,raw:unknown){
  const input=z.object({start:z.string(),end:z.string(),granularity:z.enum(["month","day"]).optional()}).strict().parse(raw);
  if(input.granularity==="day")return dailyFinancialTrend(db,homeId,input.start,input.end);
  const start=monthSchema.parse(input.start),end=monthSchema.parse(input.end);
  const count=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5))-Number(start.slice(5))+1;
  if(count<1||count>36)throw new InventoryError(400,"INVALID_TREND_RANGE","error.validation");
  const home=requireHome(db,homeId);
  const spent=db.prepare("SELECT COALESCE(SUM(purchase_total_minor),0)/100.0 AS total FROM stock_batches WHERE home_id=? AND received_at>=? AND received_at<? AND purchase_total_minor IS NOT NULL");
  const actual=(from:string,to:string)=>(spent.get(homeId,`${from}T00:00:00.000Z`,`${dayAfter(to)}T00:00:00.000Z`) as {total:number}).total;
  const today=new Date().toISOString().slice(0,10),cutoff=monthEnd(end)<today?monthEnd(end):today;
  const compare=(offset:number)=>{
    const from=`${shiftMonth(start,offset)}-01`,to=cutoff===monthEnd(end)?monthEnd(shiftMonth(end,offset)):shiftDate(cutoff,offset);
    return {start:from,end:to,actual:cutoff<`${start}-01`?0:actual(from,to)};
  };
  const current={start:`${start}-01`,end:cutoff,actual:actual(`${start}-01`,cutoff)};
  const previous=compare(-count),yearAgo=compare(-12);
  const comparison=(value:typeof previous)=>({...value,difference:Math.round((current.actual-value.actual)*100)/100,percent:value.actual===0?null:Math.round((current.actual-value.actual)/value.actual*10000)/100});
  const points=Array.from({length:count},(_,index)=>{
    const month=shiftMonth(start,index);
    const [from,until]=monthRange(month);
    const planned=(db.prepare("SELECT COALESCE(SUM(estimated_total_minor),0)/100.0 AS total FROM shopping_list WHERE home_id=? AND completed=0 AND planned_date>=? AND planned_date<? AND estimated_total_minor IS NOT NULL").get(homeId,from,until) as {total:number}).total;
    return {label:month,month,actual:actual(`${month}-01`,monthEnd(month)),planned,budget:budgetForMonth(db,homeId,month).total};
  });
  return {granularity:"month",start,end,currency:home.currency,current,previous:comparison(previous),yearAgo:comparison(yearAgo),points};
}

const costAnalysisFilters=z.object({start:z.string(),end:z.string(),granularity:z.enum(["month","day"]).default("month"),asOf:z.string().date().optional()}).strict();
type CostPoint={label:string;inbound:number;consumed:number;expired:number;damaged:number;adjustment:number};
type WasteValue={wastedValue:number;expiredValue:number;damagedValue:number;batchIds:Set<string>};
const rounded=(value:number)=>Math.round(value*100)/100;

export function inventoryCostAnalysis(db:DatabaseSync,homeId:string,raw:unknown) {
  const input=costAnalysisFilters.parse(raw);
  const home=requireHome(db,homeId);
  const asOf=input.asOf??new Date().toISOString().slice(0,10);
  const cutoff=`${dayAfter(asOf)}T00:00:00.000Z`;
  let start:string,end:string,until:string,labels:string[];
  if(input.granularity==="day") {
    start=dateSchema.parse(input.start);end=dateSchema.parse(input.end);
    const days=Math.floor((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000)+1;
    if(days<1||days>366)throw new InventoryError(400,"INVALID_COST_RANGE","error.validation");
    until=dayAfter(end);labels=Array.from({length:days},(_,index)=>shiftDay(start,index));
  } else {
    const startMonth=monthSchema.parse(input.start),endMonth=monthSchema.parse(input.end);
    const months=(Number(endMonth.slice(0,4))-Number(startMonth.slice(0,4)))*12+Number(endMonth.slice(5))-Number(startMonth.slice(5))+1;
    if(months<1||months>36)throw new InventoryError(400,"INVALID_COST_RANGE","error.validation");
    start=`${startMonth}-01`;end=monthEnd(endMonth);until=`${shiftMonth(endMonth,1)}-01`;labels=Array.from({length:months},(_,index)=>shiftMonth(startMonth,index));
  }
  const fromIso=`${start}T00:00:00.000Z`,untilIso=`${until}T00:00:00.000Z`<cutoff?`${until}T00:00:00.000Z`:cutoff;
  const labelFor=(timestamp:string)=>input.granularity==="day"?timestamp.slice(0,10):timestamp.slice(0,7);
  const points=new Map(labels.map(label=>[label,{label,inbound:0,consumed:0,expired:0,damaged:0,adjustment:0} satisfies CostPoint]));
  const inboundRows=db.prepare(`SELECT b.id AS batchId,b.item_id AS itemId,i.name AS itemName,i.base_unit AS unit,b.received_at AS occurredAt,b.purchase_total_minor AS purchaseTotalMinor,
    COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.batch_id=b.id AND t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%'),0) AS initialQuantity
    FROM stock_batches b JOIN items i ON i.id=b.item_id WHERE b.home_id=? AND b.received_at>=? AND b.received_at<?`).all(homeId,fromIso,untilIso) as {batchId:string;itemId:string;itemName:string;unit:string;occurredAt:string;purchaseTotalMinor:number|null;initialQuantity:number}[];
  let inbound=0,unknownInboundBatchCount=0;
  const unknownInboundBatches:{batchId:string;itemId:string;itemName:string;unit:string;receivedDate:string;quantity:number;reason:"missingCost"|"missingQuantity"}[]=[];
  for(const row of inboundRows) {
    if(row.purchaseTotalMinor===null||row.initialQuantity<=0){unknownInboundBatchCount++;unknownInboundBatches.push({batchId:row.batchId,itemId:row.itemId,itemName:row.itemName,unit:row.unit,receivedDate:row.occurredAt.slice(0,10),quantity:row.initialQuantity,reason:row.purchaseTotalMinor===null?"missingCost":"missingQuantity"});continue;}
    const value=row.purchaseTotalMinor/100;inbound+=value;const point=points.get(labelFor(row.occurredAt));if(point)point.inbound+=value;
  }
  const issues=db.prepare(`SELECT t.id,t.batch_id AS batchId,t.item_id AS itemId,i.name AS itemName,i.base_unit AS unit,COALESCE(b.purchase_category,i.category,'其他') AS category,
    t.location_id AS locationId,COALESCE(l.name,'未指定') AS locationName,t.quantity,t.issue_reason AS issueReason,t.occurred_at AS occurredAt,b.purchase_total_minor AS purchaseTotalMinor,
    COALESCE((SELECT SUM(origin.quantity) FROM stock_transactions origin WHERE origin.batch_id=b.id AND origin.type='receipt' AND origin.idempotency_key NOT LIKE 'event:%'),0) AS initialQuantity
    FROM stock_transactions t JOIN stock_batches b ON b.id=t.batch_id JOIN items i ON i.id=t.item_id LEFT JOIN locations l ON l.id=t.location_id
    WHERE t.home_id=? AND t.type='issue' AND t.issue_reason IN ('used','expired','damaged','adjustment') AND t.occurred_at>=? AND t.occurred_at<?`).all(homeId,fromIso,untilIso) as {id:string;batchId:string;itemId:string;itemName:string;unit:string;category:string;locationId:string|null;locationName:string;quantity:number;issueReason:"used"|"expired"|"damaged"|"adjustment";occurredAt:string;purchaseTotalMinor:number|null;initialQuantity:number}[];
  const totals={inbound,consumed:0,wasted:0,expired:0,damaged:0,adjustment:0,wasteRate:null as number|null};
  let unknownCostIssueCount=0;
  const unknownCostIssues:{transactionId:string;batchId:string;itemId:string;itemName:string;unit:string;occurredDate:string;quantity:number;issueReason:"used"|"expired"|"damaged"|"adjustment"}[]=[];
  const wasteByItem=new Map<string,WasteValue&{itemId:string;itemName:string;category:string}>();
  const wasteByCategory=new Map<string,WasteValue&{category:string}>();
  const wasteByLocation=new Map<string,WasteValue&{locationId:string|null;locationName:string}>();
  const addWaste=(target:WasteValue,reason:"expired"|"damaged",batchId:string,value:number)=>{target.batchIds.add(batchId);target.wastedValue+=value;if(reason==="expired")target.expiredValue+=value;else target.damagedValue+=value;};
  for(const row of issues) {
    if(row.purchaseTotalMinor===null||row.initialQuantity<=0){unknownCostIssueCount++;unknownCostIssues.push({transactionId:row.id,batchId:row.batchId,itemId:row.itemId,itemName:row.itemName,unit:row.unit,occurredDate:row.occurredAt.slice(0,10),quantity:row.quantity,issueReason:row.issueReason});continue;}
    const value=row.purchaseTotalMinor/100/row.initialQuantity*row.quantity;
    const point=points.get(labelFor(row.occurredAt));if(point)point[row.issueReason==="used"?"consumed":row.issueReason]+=value;
    if(row.issueReason==="used")totals.consumed+=value;
    else if(row.issueReason==="adjustment")totals.adjustment+=value;
    else {
      totals[row.issueReason]+=value;totals.wasted+=value;
      const locationKey=row.locationId??"";
      const base=()=>({wastedValue:0,expiredValue:0,damagedValue:0,batchIds:new Set<string>()});
      const item=wasteByItem.get(row.itemId)??{...base(),itemId:row.itemId,itemName:row.itemName,category:row.category};addWaste(item,row.issueReason,row.batchId,value);wasteByItem.set(row.itemId,item);
      const category=wasteByCategory.get(row.category)??{...base(),category:row.category};addWaste(category,row.issueReason,row.batchId,value);wasteByCategory.set(row.category,category);
      const location=wasteByLocation.get(locationKey)??{...base(),locationId:row.locationId,locationName:row.locationName};addWaste(location,row.issueReason,row.batchId,value);wasteByLocation.set(locationKey,location);
    }
  }
  // Batch lifetimes use one explicit cutoff, regardless of the selected event window.
  const batchRows=db.prepare(`SELECT b.id AS batchId,b.item_id AS itemId,i.name AS itemName,b.received_at AS receivedAt,b.purchase_total_minor AS cost,
    SUM(CASE WHEN t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%' THEN t.quantity ELSE 0 END) AS initialQuantity,
    SUM(CASE WHEN t.type='issue' AND t.issue_reason='used' AND t.occurred_at<? THEN t.quantity ELSE 0 END) AS used,
    SUM(CASE WHEN t.type='issue' AND t.issue_reason IN ('expired','damaged') AND t.occurred_at<? THEN t.quantity ELSE 0 END) AS wasted,
    SUM(CASE WHEN t.type='issue' AND t.idempotency_key NOT LIKE 'event:%' AND (t.issue_reason='adjustment' OR t.issue_reason IS NULL) AND t.occurred_at<? THEN t.quantity ELSE 0 END) AS adjusted
    FROM stock_batches b JOIN items i ON i.id=b.item_id JOIN stock_transactions t ON t.batch_id=b.id AND t.home_id=b.home_id
    WHERE b.home_id=? AND b.received_at<? GROUP BY b.id`).all(cutoff,cutoff,cutoff,homeId,cutoff) as {batchId:string;itemId:string;itemName:string;receivedAt:string;cost:number|null;initialQuantity:number;used:number;wasted:number;adjusted:number}[];
  const batches=batchRows.map(row=>{
    const originalCost=row.cost===null||row.initialQuantity<=0?null:row.cost/100;
    const unit=originalCost===null?null:originalCost/row.initialQuantity;
    return {batchId:row.batchId,itemId:row.itemId,itemName:row.itemName,receivedDate:row.receivedAt.slice(0,10),originalCost,
      usedCost:unit===null?null:rounded(unit*row.used),wastedCost:unit===null?null:rounded(unit*row.wasted),
      adjustmentCost:unit===null?null:rounded(unit*row.adjusted),remainingCost:unit===null?null:rounded(originalCost!-rounded(unit*row.used)-rounded(unit*row.wasted)-rounded(unit*row.adjusted)),
      usedShare:originalCost===null||originalCost===0?null:rounded(row.used/row.initialQuantity*100)};
  });
  const cohortPoints=labels.map(label=>{
    const selected=batches.filter(batch=>labelFor(batch.receivedDate)===label);
    const known=selected.filter(batch=>batch.originalCost!==null);
    const sum=(key:"originalCost"|"usedCost"|"wastedCost"|"adjustmentCost"|"remainingCost")=>rounded(known.reduce((total,batch)=>total+(batch[key]??0),0));
    const originalCost=sum("originalCost"),usedCost=sum("usedCost");
    return {label,originalCost,usedCost,wastedCost:sum("wastedCost"),adjustmentCost:sum("adjustmentCost"),remainingCost:sum("remainingCost"),unknownCostBatchCount:selected.length-known.length,usedShare:originalCost>0?rounded(usedCost/originalCost*100):null};
  });
  const denominator=totals.consumed+totals.wasted;totals.wasteRate=denominator>0?rounded(totals.wasted/denominator*100):null;
  const today=new Date().toISOString().slice(0,10),riskThrough=shiftDay(today,30);
  const riskRows=db.prepare(`SELECT b.id AS batchId,b.item_id AS itemId,i.name AS itemName,b.expiry_date AS expiryDate,i.base_unit AS unit,b.purchase_total_minor AS purchaseTotalMinor,
    COALESCE((SELECT SUM(origin.quantity) FROM stock_transactions origin WHERE origin.batch_id=b.id AND origin.type='receipt' AND origin.idempotency_key NOT LIKE 'event:%'),0) AS initialQuantity,
    COALESCE(SUM(CASE WHEN t.type='receipt' THEN t.quantity ELSE -t.quantity END),0) AS quantity
    FROM stock_batches b JOIN items i ON i.id=b.item_id LEFT JOIN stock_transactions t ON t.batch_id=b.id AND t.home_id=b.home_id
    WHERE b.home_id=? AND b.expiry_date>=? AND b.expiry_date<=? GROUP BY b.id
    HAVING SUM(CASE WHEN t.type='receipt' THEN t.quantity ELSE -t.quantity END)>0
    ORDER BY b.expiry_date,i.name`).all(homeId,today,riskThrough) as {batchId:string;itemId:string;itemName:string;expiryDate:string;unit:string;purchaseTotalMinor:number|null;initialQuantity:number;quantity:number}[];
  let riskValue=0,unknownRiskBatchCount=0;
  const riskItems=riskRows.map(row=>{const value=row.purchaseTotalMinor===null||row.initialQuantity<=0?null:rounded(row.purchaseTotalMinor/100/row.initialQuantity*row.quantity);if(value===null)unknownRiskBatchCount++;else riskValue+=value;return {...row,value};});
  const cleanWaste=<T extends WasteValue>({batchIds,...row}:T)=>{
    const related=batches.filter(batch=>batchIds.has(batch.batchId));
    return {...row,wastedValue:rounded(row.wastedValue),expiredValue:rounded(row.expiredValue),damagedValue:rounded(row.damagedValue),
      originalCost:rounded(related.reduce((sum,batch)=>sum+(batch.originalCost??0),0)),batches:related};
  };

  return {granularity:input.granularity,start:input.start,end:input.end,asOf,currency:home.currency,cohorts:{asOf,points:cohortPoints},totals:{...totals,inbound:rounded(totals.inbound),consumed:rounded(totals.consumed),wasted:rounded(totals.wasted),expired:rounded(totals.expired),damaged:rounded(totals.damaged),adjustment:rounded(totals.adjustment)},points:[...points.values()].map(point=>Object.fromEntries(Object.entries(point).map(([key,value])=>[key,typeof value==="number"?rounded(value):value])) as CostPoint),waste:{byItem:[...wasteByItem.values()].map(cleanWaste).sort((a,b)=>b.wastedValue-a.wastedValue),byCategory:[...wasteByCategory.values()].map(cleanWaste).sort((a,b)=>b.wastedValue-a.wastedValue),byLocation:[...wasteByLocation.values()].map(cleanWaste).sort((a,b)=>b.wastedValue-a.wastedValue)},expiryRisk:{asOf:today,through:riskThrough,value:rounded(riskValue),unknownCostBatchCount:unknownRiskBatchCount,items:riskItems},dataQuality:{unknownInboundBatchCount,unknownCostIssueCount,unknownInboundBatches,unknownCostIssues}};
}
function dailyFinancialTrend(db:DatabaseSync,homeId:string,start:string,end:string) {
  const from=dateSchema.parse(start),to=dateSchema.parse(end);
  const days=Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;
  if(days<1||days>366)throw new InventoryError(400,"INVALID_TREND_RANGE","error.validation");
  const home=requireHome(db,homeId);
  const spent=db.prepare("SELECT COALESCE(SUM(purchase_total_minor),0)/100.0 AS total FROM stock_batches WHERE home_id=? AND received_at>=? AND received_at<? AND purchase_total_minor IS NOT NULL");
  const actual=(rangeStart:string,rangeEnd:string)=>(spent.get(homeId,`${rangeStart}T00:00:00.000Z`,`${dayAfter(rangeEnd)}T00:00:00.000Z`) as {total:number}).total;
  const today=new Date().toISOString().slice(0,10),cutoff=to<today?to:today;
  const current={start:from,end:cutoff,actual:from>cutoff?0:actual(from,cutoff)};
  const compare=(rangeStart:string,rangeEnd:string)=>({start:rangeStart,end:rangeEnd,actual:from>cutoff?0:actual(rangeStart,rangeEnd)});
  const previous=compare(shiftDay(from,-days),shiftDay(from,-1));
  const yearAgo=compare(shiftYear(from,-1),shiftYear(cutoff,-1));
  const comparison=(value:typeof previous)=>({...value,difference:Math.round((current.actual-value.actual)*100)/100,percent:value.actual===0?null:Math.round((current.actual-value.actual)/value.actual*10000)/100});
  const planned=db.prepare("SELECT COALESCE(SUM(estimated_total_minor),0)/100.0 AS total FROM shopping_list WHERE home_id=? AND completed=0 AND planned_date=? AND estimated_total_minor IS NOT NULL");
  const points=Array.from({length:days},(_,index)=>{
    const day=shiftDay(from,index);
    return {label:day,day,actual:actual(day,day),planned:(planned.get(homeId,day) as {total:number}).total,budget:null};
  });
  return {granularity:"day",start:from,end:to,currency:home.currency,current,previous:comparison(previous),yearAgo:comparison(yearAgo),points};
}
function budgetForMonth(db:DatabaseSync,homeId:string,month:string) {
  const budget=db.prepare("SELECT month,total_minor/100.0 AS total FROM finance_budgets WHERE home_id=? AND month<=? ORDER BY month DESC LIMIT 1").get(homeId,month) as {month:string;total:number}|undefined;
  if(!budget)return {total:null,sourceMonth:null,categoryBudgets:[] as {category:string;amount:number}[]};
  const categoryBudgets=db.prepare("SELECT category,amount_minor/100.0 AS amount FROM finance_category_budgets WHERE home_id=? AND month=? ORDER BY category").all(homeId,budget.month) as {category:string;amount:number}[];
  return {total:budget.total,sourceMonth:budget.month,categoryBudgets};
}
function totalsByCategory(db:DatabaseSync,homeId:string,month:string,kind:"actual"|"planned") {
  const [from,until]=monthRange(month);
  const sql=kind==="actual"
    ? "SELECT COALESCE(purchase_category,'其他') AS category,SUM(purchase_total_minor)/100.0 AS total FROM stock_batches WHERE home_id=? AND received_at>=? AND received_at<? AND purchase_total_minor IS NOT NULL GROUP BY COALESCE(purchase_category,'其他')"
    : "SELECT COALESCE(category,'其他') AS category,SUM(estimated_total_minor)/100.0 AS total FROM shopping_list WHERE home_id=? AND completed=0 AND planned_date>=? AND planned_date<? AND estimated_total_minor IS NOT NULL GROUP BY COALESCE(category,'其他')";
  return db.prepare(sql).all(homeId,from,until) as MoneyRow[];
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
  const ancestors=categoryAncestors(db,homeId);
  const allocations=input.categoryBudgets.map(budget=>({...budget,parent:ancestors(budget.category).slice(1).find(parent=>categories.has(parent))??null}));
  const categoryTotal=allocations.filter(row=>row.parent===null).reduce((total,row)=>total+Math.round(row.amount*100),0)/100;
  for(const row of allocations) {
    const reserved=allocations.filter(child=>child.parent===row.category).reduce((sum,child)=>sum+Math.round(child.amount*100),0);
    if(reserved>Math.round(row.amount*100))
      throw new InventoryError(400,"CHILD_BUDGET_EXCEEDS_PARENT","error.childBudgetExceedsParent",{category:row.category});
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
  const [from,until]=monthRange(month);
  const actual=(db.prepare("SELECT COALESCE(SUM(purchase_total_minor),0)/100.0 AS total FROM stock_batches WHERE home_id=? AND received_at>=? AND received_at<? AND purchase_total_minor IS NOT NULL").get(homeId,from,until) as {total:number}).total;
  const planned=(db.prepare("SELECT COALESCE(SUM(estimated_total_minor),0)/100.0 AS total FROM shopping_list WHERE home_id=? AND completed=0 AND planned_date>=? AND planned_date<? AND estimated_total_minor IS NOT NULL").get(homeId,from,until) as {total:number}).total;
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
      // Each cap includes its subtree. Monthly spending still sums direct costs only.
      const owners=path.filter(name=>budgetNames.has(name));
      for(const category of owners.length?owners:[path[0]])totals.set(category,(totals.get(category)??0)+row.total);
    }
    return [...totals].map(([category,total])=>({category,total}));
  };
  const categoryDistribution=mergeDistribution(rollup(actualByCategory),rollup(plannedByCategory));
  for(const categoryBudget of categoryBudgets)if(!categoryDistribution.some(row=>row.category===categoryBudget.category))categoryDistribution.push({category:categoryBudget.category,actual:0,planned:0});
  const byCategory=categoryDistribution.map(row=>({...row,budget:categoryBudgets.find(budget=>budget.category===row.category)?.amount??null})).sort((left,right)=>(right.actual+right.planned)-(left.actual+left.planned)||left.category.localeCompare(right.category));
  const byChannel=db.prepare("SELECT b.channel_id AS channelId,COALESCE(c.name,'未指定') AS channelName,SUM(b.purchase_total_minor)/100.0 AS total FROM stock_batches b LEFT JOIN shopping_channels c ON c.id=b.channel_id WHERE b.home_id=? AND b.received_at>=? AND b.received_at<? AND b.purchase_total_minor IS NOT NULL GROUP BY b.channel_id,c.name ORDER BY total DESC").all(homeId,from,until);
  const purchases=db.prepare(`SELECT b.id AS batchId,b.item_id AS itemId,i.name AS itemName,COALESCE(b.purchase_category,i.category) AS category,substr(b.received_at,1,10) AS receivedDate,b.purchased_date AS purchaseDate,b.purchase_total_minor/100.0 AS totalPrice,b.purchase_currency AS currency,b.channel_id AS channelId,COALESCE(c.name,'未指定') AS channelName,b.shopping_item_id AS shoppingItemId,s.estimated_total_minor/100.0 AS estimatedTotal,
    COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.batch_id=b.id AND t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%'),0) AS quantity
    FROM stock_batches b JOIN items i ON i.id=b.item_id LEFT JOIN shopping_channels c ON c.id=b.channel_id LEFT JOIN shopping_list s ON s.id=b.shopping_item_id
    WHERE b.home_id=? AND b.received_at>=? AND b.received_at<? AND b.purchase_total_minor IS NOT NULL ORDER BY b.received_at DESC LIMIT 200`).all(homeId,from,until) as {batchId:string;quantity:number;totalPrice:number;estimatedTotal:number|null}[];
  const purchaseRecords=purchases.map(row=>({...row,unitPrice:row.quantity>0?Math.round(row.totalPrice/row.quantity*100)/100:null,variance:row.estimatedTotal==null?null:Math.round((row.totalPrice-row.estimatedTotal)*100)/100}));
  const trend=[];
  for(let offset=-11;offset<=0;offset++) {
    const point=shiftMonth(month,offset);
    const [pointFrom,pointUntil]=monthRange(point);
    const spent=(db.prepare("SELECT COALESCE(SUM(purchase_total_minor),0)/100.0 AS total FROM stock_batches WHERE home_id=? AND received_at>=? AND received_at<? AND purchase_total_minor IS NOT NULL").get(homeId,pointFrom,pointUntil) as {total:number}).total;
    const pending=(db.prepare("SELECT COALESCE(SUM(estimated_total_minor),0)/100.0 AS total FROM shopping_list WHERE home_id=? AND completed=0 AND planned_date>=? AND planned_date<? AND estimated_total_minor IS NOT NULL").get(homeId,pointFrom,pointUntil) as {total:number}).total;
    const limit=budgetForMonth(db,homeId,point);
    trend.push({month:point,actual:spent,planned:pending,budget:limit.total});
  }
  const forecast=actual+planned;
  return {month,currency:home.currency,budgetTotal:budget.total,budgetSourceMonth:budget.sourceMonth,budgetMode:budget.sourceMonth===null?"none":budget.sourceMonth===month?"explicit":"inherited",categoryBudgets,spendingTotal:actual,estimatedTotal:planned,forecastTotal:forecast,remainingBudget:budget.total===null?null:Math.round((budget.total-forecast)*100)/100,variance:actual-planned,categorySpending:mergeDistribution(actualByCategory,plannedByCategory),byCategory,byChannel,purchases:purchaseRecords,trend};
}

export const financialSummary=financialDashboard;

export function itemPriceHistory(db:DatabaseSync,homeId:string,itemId:string) {
  if(!db.prepare("SELECT 1 FROM items WHERE id=? AND home_id=? AND active=1").get(itemId,homeId))throw new InventoryError(404,"ITEM_NOT_FOUND","error.itemNotFoundOrDeleted");
  const items=db.prepare(`SELECT b.id AS batchId,b.purchased_date AS purchaseDate,b.channel_id AS channelId,c.name AS channelName,b.purchase_currency AS currency,b.purchase_total_minor/100.0 AS totalPrice,COALESCE((SELECT SUM(t.quantity) FROM stock_transactions t WHERE t.batch_id=b.id AND t.type='receipt' AND t.idempotency_key NOT LIKE 'event:%'),0) AS quantity FROM stock_batches b LEFT JOIN shopping_channels c ON c.id=b.channel_id WHERE b.home_id=? AND b.item_id=? AND b.purchase_total_minor IS NOT NULL ORDER BY b.purchased_date DESC,b.received_at DESC`).all(homeId,itemId) as {batchId:string;purchaseDate:string|null;channelId:string|null;channelName:string|null;currency:string;totalPrice:number;quantity:number}[];
  return {itemId,items:items.map(item=>({...item,unitPrice:item.quantity>0?Math.round(item.totalPrice/item.quantity*100)/100:null}))};
}
