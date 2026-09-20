import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {useTranslation} from "react-i18next";
import {apiFetch} from "./i18n/apiFetch.js";
import {adjacentMonth} from "./purchaseSchedule.js";
import {spendingTrendScale} from "./spendingTrend.js";
import { categoryLabel, channelLabel } from "./systemLabels.js";
import "./financeReports.css";

function useReport<T>(url:string,revision:unknown){
  const [result,setResult]=useState<{url:string;data:T}|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!url){setLoading(false);return;}
    const controller=new AbortController();
    setLoading(true);setError("");setResult(null);
    apiFetch(url,{signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.message||String(response.status));return body as T;}).then(data=>{if(!controller.signal.aborted)setResult({url,data});}).catch(error=>{if(!controller.signal.aborted)setError(String(error.message));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[url,revision,retry]);
  return {data:result?.url===url?result.data:null,error,loading,retry:()=>setRetry(value=>value+1)};
}
const endOfMonth=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
const shiftDay=(date:string,offset:number)=>{const value=new Date(`${date}T00:00:00.000Z`);value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10);};
type Comparison={start:string;end:string;actual:number;difference:number;percent:number|null};
type TrendReport={granularity:"month"|"day";currency:string;current:{start:string;end:string;actual:number};previous:Comparison;yearAgo:Comparison;points:{label:string;actual:number;planned:number;budget:number|null}[]};

export function FinanceTrend({homeId,month,revision}:{homeId:string;month:string;revision:unknown}){
  const {t,i18n}=useTranslation();
  const [mode,setMode]=useState("12"),[year,setYear]=useState(month.slice(0,4));
  const [customStart,setCustomStart]=useState(adjacentMonth(month,-11)),[customEnd,setCustomEnd]=useState(month);
  const currentMonth=new Date().toISOString().slice(0,7);
  const today=new Date().toISOString().slice(0,10);
  const daily=mode==="30";
  const end=daily?today:mode==="custom"?customEnd:mode==="year"?`${year}-12`:mode==="ytd"?currentMonth:month;
  const start=daily?shiftDay(today,-29):mode==="custom"?customStart:mode==="year"?`${year}-01`:mode==="ytd"?`${currentMonth.slice(0,4)}-01`:adjacentMonth(month,1-Number(mode));
  const length=daily?30:(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5))-Number(start.slice(5))+1;
  const valid=daily||(/^\d{4}-\d{2}$/.test(start)&&/^\d{4}-\d{2}$/.test(end)&&length>0&&length<=36);
  const report=useReport<TrendReport>(valid?`/api/v1/homes/${homeId}/financial-trend?start=${start}&end=${end}${daily?"&granularity=day":""}`:"",revision);
  const money=(value:number)=>new Intl.NumberFormat(i18n.language,{style:"currency",currency:report.data?.currency??"CNY"}).format(value);
  const data=report.data,max=spendingTrendScale(data?.points??[]);
  const scroll=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(scroll.current)scroll.current.scrollLeft=scroll.current.scrollWidth;},[data]);
  const comparison=(label:string,value:Comparison)=><div title={`${value.start} — ${value.end}`}><small>{label}</small><strong className={value.difference>0?"report-increase":value.difference<0?"report-decrease":""}>{value.percent===null?(value.difference===0?"0%":t("无对比基数")):`${value.percent>0?"+":""}${value.percent}%`}</strong><span>{value.difference>0?"+":value.difference<0?"−":""}{money(Math.abs(value.difference))}</span><small>{value.start} — {value.end}</small></div>;
  return <section className="panel finance-trend">
    <div className="panel-head"><div><h2>{t("支出趋势")}</h2><p className="muted">{daily?`${t("实际支出")}、${t("待采购预计")}`:t("实际支出、待采购预计与月度预算")}</p></div></div>
    <div className="report-controls"><div className="report-presets">{[["30",t("近30天")],["6",t("近6个月")],["12",t("近12个月")],["ytd",t("本年")],["year",t("全年")],["custom",t("自定义")]].map(([value,label])=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div>
      {mode==="year"&&<label>{t("年份")}<input aria-label={t("年份")} type="number" min="1900" max="9999" value={year} onChange={event=>setYear(event.target.value)}/></label>}
      {mode==="custom"&&<div className="report-range"><label>{t("开始月份")}<input type="month" value={customStart} onChange={event=>setCustomStart(event.target.value)}/></label><label>{t("结束月份")}<input type="month" value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></label></div>}
      {valid&&<small className="report-range-caption">{start} — {end}</small>}
    </div>
    {!valid?<p className="empty" role="alert">{t("请选择不超过36个月的有效范围")}</p>:report.error?<p className="empty" role="alert">{report.error} <button onClick={report.retry}>{t("重试")}</button></p>:report.loading||!data?<p className="empty" role="status">{t("加载中…")}</p>:<>
      <div className="report-comparisons"><div><small>{t("区间支出")}</small><strong>{money(data.current.actual)}</strong><small>{data.current.start} — {data.current.end}</small></div>{comparison(t("环比"),data.previous)}{comparison(t("同比"),data.yearAgo)}</div>
      <div className="trend-scroll" ref={scroll}><div className="trend-chart" style={{minWidth:Math.max(0,data.points.length*(data.granularity==="day"?58:38))}} aria-label={t("支出趋势")}>
        {data.points.map(point=>{
          const remaining=point.budget===null?null:(Math.round(point.budget*100)-Math.round(point.actual*100)-Math.round(point.planned*100))/100;
          const tooltip=[point.label,...(point.budget===null?[]:[`${t("月度预算")} ${money(point.budget)}`]),`${t("已花")} ${money(point.actual)}`,`${t("待采购")} ${money(point.planned)}`,...(remaining===null?[]:[`${remaining<0?t("超支"):t("剩余")} ${money(Math.abs(remaining))}`])].join("\n");
          return <div className="trend-column" key={point.label} tabIndex={0} role="img" aria-label={tooltip} data-tooltip={tooltip}><div className="trend-stack"><i className={point.budget!==null&&point.actual>point.budget?"over":undefined} style={{height:`${point.actual/max*100}%`}}/><em className={remaining!==null&&remaining<0?"over":undefined} style={{height:`${point.planned/max*100}%`}}/>{point.budget!==null&&<b style={{bottom:`${point.budget/max*100}%`}}/>}</div><small>{data.granularity==="day"?point.label.slice(5):point.label.slice(2)}</small></div>;
        })}
      </div></div><div className="chart-legend"><span><i className="actual"/>{t("实际支出")}</span><span><i className="planned"/>{t("待采购预计")}</span>{data.granularity==="month"&&<span><i className="budget"/>{t("月度预算")}</span>}</div>
    </>}
  </section>;
}

type PurchaseReport={currency:string;total:number;amount:number;page:number;totalPages:number;items:{batchId:string;itemId:string;itemName:string;category:string;receivedDate:string;channelName:string;quantity:number;unitPrice:number|null;totalPrice:number;variance:number|null}[]};
export function FinancePurchases({homeId,revision,onOpenItem}:{homeId:string;revision:unknown;onOpenItem:(id:string)=>void}){
  const {t,i18n}=useTranslation();
  const currentMonth=new Date().toISOString().slice(0,7);
  const [mode,setMode]=useState("current"),[customStart,setCustomStart]=useState(`${currentMonth}-01`),[customEnd,setCustomEnd]=useState(endOfMonth(currentMonth));
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(20);
  const selected=mode==="previous"?adjacentMonth(currentMonth,-1):currentMonth;
  const start=mode==="custom"?customStart:`${selected}-01`,end=mode==="custom"?customEnd:endOfMonth(selected);
  const valid=!!start&&!!end&&start<=end;
  const report=useReport<PurchaseReport>(valid?`/api/v1/homes/${homeId}/purchase-records?start=${start}&end=${end}&page=${page}&pageSize=${pageSize}`:"",revision);
  const data=report.data;
  const money=(value:number)=>new Intl.NumberFormat(i18n.language,{style:"currency",currency:data?.currency??"CNY"}).format(value);
  return <section className="panel finance-purchases"><div className="panel-head"><div><h2>{t("采购流水")}</h2><p className="muted">{t("已录入成本的入库批次")}</p></div>{data&&<strong>{money(data.amount)} <small>{t("共{{count}}笔",{count:data.total})}</small></strong>}</div>
    <div className="report-controls"><div className="report-presets">{[["current",t("本月")],["previous",t("上月")],["custom",t("时间范围")]].map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} onClick={()=>{setMode(value);setPage(1);}}>{label}</button>)}</div>
      {mode==="custom"&&<div className="report-range"><label>{t("开始日期")}<input type="date" value={customStart} onChange={event=>{setCustomStart(event.target.value);setPage(1);}}/></label><label>{t("结束日期")}<input type="date" value={customEnd} onChange={event=>{setCustomEnd(event.target.value);setPage(1);}}/></label></div>}
      <small className="report-range-caption">{start} — {end}</small>
    </div>
    {!valid?<p className="empty" role="alert">{t("请选择有效日期范围")}</p>:report.error?<p className="empty" role="alert">{report.error} <button onClick={report.retry}>{t("重试")}</button></p>:report.loading||!data?<p className="empty" role="status">{t("加载中…")}</p>:<>
      <div className="table-wrap"><table><thead><tr>{["入库日期","物资","分类","渠道","数量","单价","实付总价","预计差异"].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{data.items.length?data.items.map(row=><tr key={row.batchId}><td>{row.receivedDate}</td><td><button type="button" className="item-link" onClick={()=>onOpenItem(row.itemId)}>{row.itemName}</button></td><td>{categoryLabel(row.category)}</td><td>{channelLabel(row.channelName)}</td><td>{row.quantity}</td><td>{row.unitPrice===null?t("未知"):money(row.unitPrice)}</td><td>{money(row.totalPrice)}</td><td className={row.variance!==null&&row.variance>0?"negative":""}>{row.variance===null?"—":money(row.variance)}</td></tr>):<tr><td colSpan={8} className="empty">{t("此范围暂无采购流水")}</td></tr>}</tbody></table></div>
      <div className="purchase-cards">{data.items.length?data.items.map(row=><article className="purchase-card" key={row.batchId}><div><button type="button" className="item-link" onClick={()=>onOpenItem(row.itemId)}>{row.itemName}</button><strong>{money(row.totalPrice)}</strong></div><div><small>{categoryLabel(row.category)} · {channelLabel(row.channelName)}</small><small>{row.receivedDate}</small></div><small>{t("数量")} {row.quantity} · {t("单价")} {row.unitPrice===null?t("未知"):money(row.unitPrice)}{row.variance!==null?` · ${t("预计差异")} ${money(row.variance)}`:""}</small></article>):<p className="empty">{t("此范围暂无采购流水")}</p>}</div>
      <div className="report-pagination"><label>{t("每页")}<select value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPage(1);}}>{[20,50,100].map(size=><option key={size}>{size}</option>)}</select></label><span>{data.page} / {data.totalPages}</span><button type="button" disabled={data.page<=1} onClick={()=>setPage(data.page-1)}>{t("上一页")}</button><button type="button" disabled={data.page>=data.totalPages} onClick={()=>setPage(data.page+1)}>{t("下一页")}</button></div>
    </>}
  </section>;
}

type BatchCosts={batchId:string;itemId:string;itemName:string;receivedDate:string;originalCost:number|null;usedCost:number|null;wastedCost:number|null;adjustmentCost:number|null;remainingCost:number|null;usedShare:number|null};
type WasteRow={originalCost:number;wastedValue:number;expiredValue:number;damagedValue:number;batches:BatchCosts[]};
type CohortPoint={label:string;originalCost:number;usedCost:number;wastedCost:number;adjustmentCost:number;remainingCost:number;unknownCostBatchCount:number;usedShare:number|null};
type InventoryCostReport={asOf:string;cohorts:{asOf:string;points:CohortPoint[]};granularity:"month"|"day";start:string;end:string;currency:string;totals:{inbound:number;consumed:number;wasted:number;expired:number;damaged:number;adjustment:number;wasteRate:number|null};points:{label:string;inbound:number;consumed:number;expired:number;damaged:number;adjustment:number}[];waste:{byItem:(WasteRow&{itemId:string;itemName:string;category:string})[];byCategory:(WasteRow&{category:string})[];byLocation:(WasteRow&{locationId:string|null;locationName:string})[]};expiryRisk:{asOf:string;through:string;value:number;unknownCostBatchCount:number;items:{batchId:string;itemId:string;itemName:string;expiryDate:string;unit:string;quantity:number;value:number|null}[]};dataQuality:{unknownInboundBatchCount:number;unknownCostIssueCount:number}};

export function InventoryCostWaste({homeId,revision,onOpenItem}:{homeId:string;revision:unknown;onOpenItem:(id:string)=>void}) {
  const {t,i18n}=useTranslation();
  const currentMonth=new Date().toISOString().slice(0,7);
  const [mode,setMode]=useState("6"),[year,setYear]=useState(currentMonth.slice(0,4));
  const [customStart,setCustomStart]=useState(adjacentMonth(currentMonth,-5)),[customEnd,setCustomEnd]=useState(currentMonth);
  const [view,setView]=useState<"item"|"category"|"location">("item");
  const [perspective,setPerspective]=useState<"cohort"|"event">("cohort");
  const [asOf,setAsOf]=useState(new Date().toISOString().slice(0,10));
  const [percent,setPercent]=useState(false);
  const end=mode==="custom"?customEnd:mode==="year"?`${year}-12`:currentMonth;
  const start=mode==="custom"?customStart:mode==="year"?`${year}-01`:mode==="ytd"?`${currentMonth.slice(0,4)}-01`:adjacentMonth(currentMonth,1-Number(mode));
  const months=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5))-Number(start.slice(5))+1;
  const valid=!!asOf&&/^\d{4}-\d{2}$/.test(start)&&/^\d{4}-\d{2}$/.test(end)&&months>0&&months<=36;
  const report=useReport<InventoryCostReport>(valid?`/api/v1/homes/${homeId}/inventory-cost-analysis?start=${start}&end=${end}&granularity=month&asOf=${asOf}`:"",revision);
  const data=report.data;
  const money=(value:number)=>new Intl.NumberFormat(i18n.language,{style:"currency",currency:data?.currency??"CNY"}).format(value);
  const max=Math.max(1,...(data?.points.flatMap(point=>[point.inbound,point.consumed+point.expired+point.damaged+point.adjustment])??[]));
  const cohortMax=Math.max(1,...(data?.cohorts.points.map(point=>point.originalCost)??[]));
  const rankingRows=data?(view==="item"?data.waste.byItem.map(row=>({...row,key:row.itemId,name:row.itemName})):view==="category"?data.waste.byCategory.map(row=>({...row,key:row.category,itemId:null,name:categoryLabel(row.category)})):data.waste.byLocation.map(row=>({...row,key:row.locationId??"none",itemId:null,name:row.locationName}))):[];
  return <section className="inventory-cost-section" aria-labelledby="inventory-cost-title">
    <div className="finance-section-title"><div><h2 id="inventory-cost-title">{t("库存成本与损耗")}</h2><p>{t("看清物资花在哪里、如何被消耗，以及哪些成本最终成为浪费")}</p></div></div>
    <section className="panel inventory-cost-panel">
      <div className="report-controls"><div className="report-presets">{[["6",t("近6个月")],["12",t("近12个月")],["ytd",t("本年")],["year",t("全年")],["custom",t("自定义")]].map(([value,label])=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div>
        {mode==="year"&&<label>{t("年份")}<input type="number" min="1900" max="9999" value={year} onChange={event=>setYear(event.target.value)}/></label>}
        {mode==="custom"&&<div className="report-range"><label>{t("开始月份")}<input type="month" value={customStart} onChange={event=>setCustomStart(event.target.value)}/></label><label>{t("结束月份")}<input type="month" value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></label></div>}
        <label>{t("统计截止日期")}<input type="date" value={asOf} onChange={event=>setAsOf(event.target.value)}/></label>
        {valid&&<small className="report-range-caption">{start} — {end}</small>}
      </div>
      {!valid?<p className="empty" role="alert">{t("请选择不超过36个月的有效范围")}</p>:report.error?<p className="empty" role="alert">{report.error} <button onClick={report.retry}>{t("重试")}</button></p>:report.loading||!data?<p className="empty" role="status">{t("加载中…")}</p>:<>
        <div className="cost-kpis">{[[t("入库成本"),money(data.totals.inbound),"inbound"],[t("正常消耗成本"),money(data.totals.consumed),"consumed"],[t("浪费成本"),money(data.totals.wasted),"waste"],[t("出库损耗占比"),data.totals.wasteRate===null?"—":`${data.totals.wasteRate}%`,"rate"],[t("调整成本"),money(data.totals.adjustment),"adjustment"]].map(([label,value,tone])=><div className={`cost-kpi ${tone}`} key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
        {(data.dataQuality.unknownInboundBatchCount>0||data.dataQuality.unknownCostIssueCount>0)&&<div className="cost-quality" role="note"><strong>{t("部分记录未计入金额")}</strong><span>{t("缺少成本的入库批次")} {data.dataQuality.unknownInboundBatchCount} · {t("缺少成本的出库记录")} {data.dataQuality.unknownCostIssueCount}</span></div>}
        <div className="cost-grid">
          <section className="cost-chart-card">
            <div className="cost-card-head"><div><h3>{perspective==="cohort"?t("入库批次去向"):t("入库与出库趋势")}</h3><p>{perspective==="cohort"?t("按入库月份追踪，截至所选日期的累计去向"):t("按事件发生日期统计，入库与出库可能来自不同批次")}</p><p>{t("统计截止日期")} {data.asOf}</p></div></div>
            <div className="report-controls"><div className="report-presets"><button aria-pressed={perspective==="cohort"} onClick={()=>setPerspective("cohort")}>{t("入库批次去向")}</button><button aria-pressed={perspective==="event"} onClick={()=>setPerspective("event")}>{t("入库与出库趋势")}</button></div>{perspective==="cohort"&&<label><input type="checkbox" checked={percent} onChange={event=>setPercent(event.target.checked)}/>{t("百分比")}</label>}</div>
            <div className="cost-chart-scroll"><div className="cost-chart" style={{minWidth:Math.max(360,data.points.length*64)}}>
              {perspective==="cohort"?data.cohorts.points.map(point=>{
                const segments=[["usedCost","已使用成本"],["wastedCost","浪费成本"],["adjustmentCost","调整成本"],["remainingCost","剩余库存成本"]] as const;
                const description=[point.label,`${t("原始成本")} ${money(point.originalCost)}`,...segments.map(([key,label])=>`${t(label)} ${money(point[key])}`),`${t("已使用占比")} ${point.usedShare??"—"}%`].join("\n");
                return <div className="cost-column" key={point.label} tabIndex={0} role="img" aria-label={description} title={description}><div><div className="cost-stack" style={{height:`${percent?(point.originalCost>0?100:0):point.originalCost/cohortMax*100}%`}}>{segments.map(([key,label])=><span key={key} className={key} title={`${t(label)} ${money(point[key])}`} style={{height:`${point.originalCost>0?point[key]/point.originalCost*100:0}%`}}/>)}</div></div><small>{point.label.slice(2)}</small></div>;
              }):data.points.map(point=>{
                const description=`${point.label}\n${t("入库成本")} ${money(point.inbound)}\n${t("正常消耗成本")} ${money(point.consumed)}\n${t("浪费成本")} ${money(point.expired+point.damaged)}\n${t("调整成本")} ${money(point.adjustment)}`;
                const out=point.consumed+point.expired+point.damaged+point.adjustment;
                return <div className="cost-column" key={point.label} title={description} aria-label={description} role="img" tabIndex={0}><div><i style={{height:`${point.inbound/max*100}%`}}/><div className="cost-stack" style={{height:`${out/max*100}%`}}><span className="usedCost" style={{height:`${out?point.consumed/out*100:0}%`}}/><span className="wastedCost" style={{height:`${out?(point.expired+point.damaged)/out*100:0}%`}}/><span className="adjustmentCost" style={{height:`${out?point.adjustment/out*100:0}%`}}/></div></div><small>{point.label.slice(2)}</small></div>;
              })}
            </div></div>
            <div className="cost-legend">{perspective==="event"&&<span><i/>{t("入库成本")}</span>}<span><i className="consumed"/>{t("已使用成本")}</span><span><i className="waste"/>{t("浪费成本")}</span><span><i className="adjustment"/>{t("调整成本")}</span>{perspective==="cohort"&&<span><i className="remaining"/>{t("剩余库存成本")}</span>}</div>
            {perspective==="cohort"&&<div className="table-wrap"><table><thead><tr>{["入库月份","原始成本","已使用成本","浪费成本","调整成本","剩余库存成本","已使用占比"].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{data.cohorts.points.map(point=><tr key={point.label}><td>{point.label}{point.unknownCostBatchCount>0&&<small> · {t("未知成本批次")} {point.unknownCostBatchCount}</small>}</td>{[point.originalCost,point.usedCost,point.wastedCost,point.adjustmentCost,point.remainingCost].map((value,index)=><td key={index}>{money(value)}</td>)}<td>{point.usedShare===null?"—":`${point.usedShare}%`}</td></tr>)}</tbody></table></div>}
          </section>
          <section className="cost-insight-card"><div className="cost-card-head"><div><h3>{t("浪费构成")}</h3><p>{t("过期与损坏视为纯损耗，库存调整单列")}</p></div></div><dl><div><dt>{t("过期")}</dt><dd>{money(data.totals.expired)}</dd></div><div><dt>{t("损坏")}</dt><dd>{money(data.totals.damaged)}</dd></div></dl></section>
          <section className="cost-ranking-card"><div className="cost-card-head"><div><h3>{t("浪费排行")}</h3><p>{t("定位最值得调整采购量或储存方式的对象")}</p></div><div className="cost-tabs" role="tablist">{(["item","category","location"] as const).map(value=><button key={value} type="button" role="tab" aria-selected={view===value} onClick={()=>setView(value)}>{value==="item"?t("按物资"):value==="category"?t("按分类"):t("按地点")}</button>)}</div></div><div className="cost-ranking">{rankingRows.length?rankingRows.slice(0,8).map((row,index)=><div key={row.key}><span>{index+1}</span><div>{row.itemId?<button type="button" className="item-link" onClick={()=>onOpenItem(row.itemId!)}>{row.name}</button>:<strong>{row.name}</strong>}<small>{t("涉及批次原始成本")} {money(row.originalCost)}</small><details><summary>{t("查看批次去向")} · {data.asOf}</summary>{view==="location"&&<p>{t("以下为整批成本，同一批次可能涉及多个地点，请勿跨地点相加")}</p>}{row.batches.map(batch=><div className="cost-batch-detail" key={batch.batchId}><strong>{batch.itemName} · {batch.receivedDate}</strong><small>{t("原始成本")} {money(batch.originalCost??0)} · {t("已使用成本")} {money(batch.usedCost??0)} · {t("累计浪费成本")} {money(batch.wastedCost??0)} · {t("调整成本")} {money(batch.adjustmentCost??0)} · {t("剩余库存成本")} {money(batch.remainingCost??0)} · {t("已使用占比")} {batch.usedShare===null?"—":`${batch.usedShare}%`}</small></div>)}</details></div><b><small>{t("期间浪费")}</small>{money(row.wastedValue)}</b></div>):<p className="empty">{t("所选范围暂无浪费记录")}</p>}</div></section>
          <section className="cost-risk-card"><div className="cost-card-head"><div><h3>{t("未来30天临期风险")}</h3><p>{data.expiryRisk.asOf} — {data.expiryRisk.through}</p></div><strong>{money(data.expiryRisk.value)}</strong></div>{data.expiryRisk.unknownCostBatchCount>0&&<p className="cost-risk-note">{t("另有未知成本批次")} {data.expiryRisk.unknownCostBatchCount}</p>}<div className="cost-risk-list">{data.expiryRisk.items.length?data.expiryRisk.items.slice(0,8).map(item=><div key={item.batchId}><div><button type="button" className="item-link" onClick={()=>onOpenItem(item.itemId)}>{item.itemName}</button><small>{item.expiryDate} · {item.quantity} {item.unit}</small></div><b>{item.value===null?t("未知"):money(item.value)}</b></div>):<p className="empty">{t("未来30天暂无临期库存")}</p>}</div></section>
        </div>
      </>}
    </section>
  </section>;
}
