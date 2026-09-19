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
type Comparison={start:string;end:string;actual:number;difference:number;percent:number|null};
type TrendReport={currency:string;current:{start:string;end:string;actual:number};previous:Comparison;yearAgo:Comparison;points:{month:string;actual:number;planned:number;budget:number|null}[]};

export function FinanceTrend({homeId,month,revision}:{homeId:string;month:string;revision:unknown}){
  const {t,i18n}=useTranslation();
  const [mode,setMode]=useState("12"),[year,setYear]=useState(month.slice(0,4));
  const [customStart,setCustomStart]=useState(adjacentMonth(month,-11)),[customEnd,setCustomEnd]=useState(month);
  const today=new Date().toISOString().slice(0,7);
  const start=mode==="custom"?customStart:mode==="year"?`${year}-01`:mode==="ytd"?`${today.slice(0,4)}-01`:adjacentMonth(month,1-Number(mode));
  const end=mode==="custom"?customEnd:mode==="year"?`${year}-12`:mode==="ytd"?today:month;
  const length=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5))-Number(start.slice(5))+1;
  const valid=/^\d{4}-\d{2}$/.test(start)&&/^\d{4}-\d{2}$/.test(end)&&length>0&&length<=36;
  const report=useReport<TrendReport>(valid?`/api/v1/homes/${homeId}/financial-trend?start=${start}&end=${end}`:"",revision);
  const money=(value:number)=>new Intl.NumberFormat(i18n.language,{style:"currency",currency:report.data?.currency??"CNY"}).format(value);
  const data=report.data,max=spendingTrendScale(data?.points??[]);
  const scroll=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{if(scroll.current)scroll.current.scrollLeft=scroll.current.scrollWidth;},[data]);
  const comparison=(label:string,value:Comparison)=><div title={`${value.start} — ${value.end}`}><small>{label}</small><strong className={value.difference>0?"report-increase":value.difference<0?"report-decrease":""}>{value.percent===null?(value.difference===0?"0%":t("无对比基数")):`${value.percent>0?"+":""}${value.percent}%`}</strong><span>{value.difference>0?"+":value.difference<0?"−":""}{money(Math.abs(value.difference))}</span><small>{value.start} — {value.end}</small></div>;
  return <section className="panel finance-trend">
    <div className="panel-head"><div><h2>{t("支出趋势")}</h2><p className="muted">{t("实际支出、待采购预计与月度预算")}</p></div></div>
    <div className="report-controls"><div className="report-presets">{[["1",t("单月")],["6",t("近6个月")],["12",t("近12个月")],["ytd",t("本年")],["year",t("全年")],["custom",t("自定义")]].map(([value,label])=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)}>{label}</button>)}</div>
      {mode==="year"&&<label>{t("年份")}<input aria-label={t("年份")} type="number" min="1900" max="9999" value={year} onChange={event=>setYear(event.target.value)}/></label>}
      {mode==="custom"&&<div className="report-range"><label>{t("开始月份")}<input type="month" value={customStart} onChange={event=>setCustomStart(event.target.value)}/></label><label>{t("结束月份")}<input type="month" value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></label></div>}
      {valid&&<small className="report-range-caption">{start} — {end}</small>}
    </div>
    {!valid?<p className="empty" role="alert">{t("请选择不超过36个月的有效范围")}</p>:report.error?<p className="empty" role="alert">{report.error} <button onClick={report.retry}>{t("重试")}</button></p>:report.loading||!data?<p className="empty" role="status">{t("加载中…")}</p>:<>
      <div className="report-comparisons"><div><small>{t("区间支出")}</small><strong>{money(data.current.actual)}</strong><small>{data.current.start} — {data.current.end}</small></div>{comparison(t("环比"),data.previous)}{comparison(t("同比"),data.yearAgo)}</div>
      <div className="trend-scroll" ref={scroll}><div className="trend-chart" style={{minWidth:Math.max(0,data.points.length*38)}} aria-label={t("支出趋势")}>
        {data.points.map(point=>{
          const remaining=point.budget===null?null:(Math.round(point.budget*100)-Math.round(point.actual*100)-Math.round(point.planned*100))/100;
          const tooltip=[point.month,`${t("月度预算")} ${point.budget===null?t("未设置"):money(point.budget)}`,`${t("已花")} ${money(point.actual)}`,`${t("待采购")} ${money(point.planned)}`,`${remaining!==null&&remaining<0?t("超支"):t("剩余")} ${remaining===null?t("未设置"):money(Math.abs(remaining))}`].join("\n");
          return <div className="trend-column" key={point.month} tabIndex={0} role="img" aria-label={tooltip} data-tooltip={tooltip}><div className="trend-stack"><i className={point.budget!==null&&point.actual>point.budget?"over":undefined} style={{height:`${point.actual/max*100}%`}}/><em className={remaining!==null&&remaining<0?"over":undefined} style={{height:`${point.planned/max*100}%`}}/>{point.budget!==null&&<b style={{bottom:`${point.budget/max*100}%`}}/>}</div><small>{point.month.slice(2)}</small></div>;
        })}
      </div></div><div className="chart-legend"><span><i className="actual"/>{t("实际支出")}</span><span><i className="planned"/>{t("待采购预计")}</span><span><i className="budget"/>{t("月度预算")}</span></div>
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
