import {useEffect,useLayoutEffect,useRef,useState,type FormEvent,type ReactNode} from "react";
import {useTranslation} from "react-i18next";
import {apiFetch,apiJson} from "./i18n/apiFetch.js";
import {displayUnit} from "./i18n/index.js";
import {getHomeId} from "./apiClient.js";
import {BatchSelect} from "./Batches.js";
import type {Item,Location,OpenedConsumable} from "./webTypes.js";
import {roundQuantity} from "./quantity.js";
import "./inventoryWorkflows.css";

function WorkflowDialog({title,onClose,busy=false,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}){
 const {t}=useTranslation(),ref=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{const dialog=ref.current!,previous=document.activeElement as HTMLElement|null;const x=window.scrollX,y=window.scrollY;dialog.showModal();window.scrollTo({left:x,top:y,behavior:"instant"});return()=>{dialog.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} className="modal workflow-dialog" aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><div className="modal-head"><h2>{title}</h2><button className="close" type="button" disabled={busy} onClick={onClose} aria-label={t("关闭")}>×</button></div>{children}</dialog>;
}
async function bodyOrError(response:Response){const body=await response.json();if(!response.ok)throw new Error(body.message||String(response.status));return body;}

type Common={onClose:()=>void;onSaved:()=>void;locations:Location[]};
export function TransferDialog({item,locations,onClose,onSaved}:{item:Item}&Common){
 const {t}=useTranslation();
 const [source,setSource]=useState(item.locationId||locations[0]?.id||""),[target,setTarget]=useState("");
 const [quantity,setQuantity]=useState("1"),[openedId,setOpenedId]=useState("");
 const [opened,setOpened]=useState<OpenedConsumable[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const key=useRef(crypto.randomUUID()),saving=useRef(false);
 useEffect(()=>{const c=new AbortController();apiFetch(`/api/v1/homes/${getHomeId()}/opened-consumables`,{signal:c.signal}).then(bodyOrError).then(rows=>{if(!c.signal.aborted){setOpened(rows);setLoading(false);}}).catch(e=>{if(!c.signal.aborted){setError(e.message);setLoading(false);}});return()=>c.abort();},[]);
 const availableOpened=opened.filter(row=>row.itemId===item.id&&row.locationId===source);
 async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(saving.current)return;const form=new FormData(event.currentTarget);saving.current=true;setBusy(true);setError("");
  try{await bodyOrError(await apiJson(`/api/v1/homes/${getHomeId()}/stock/transfers`,"POST",{itemId:item.id,sourceLocationId:source,targetLocationId:target,quantity:Number(quantity),batchId:openedId?undefined:form.get("batchId")||undefined,openedId:openedId||undefined,idempotencyKey:key.current}));onSaved();onClose();}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{saving.current=false;setBusy(false);}
 }
 return <WorkflowDialog title={t("移动库存")} onClose={onClose} busy={busy}><p>{item.name} · {displayUnit(item.baseUnit)}</p><form onSubmit={save} onChange={()=>{key.current=crypto.randomUUID();}}><fieldset disabled={busy||loading} className="workflow-fields"><div className="form-row"><label>{t("来源地点")}<select value={source} onChange={e=>{setSource(e.target.value);setOpenedId("");}} required>{locations.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>{t("目标地点")}<select value={target} onChange={e=>setTarget(e.target.value)} required><option value="">{t("请选择")}</option>{locations.filter(row=>row.id!==source).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
 {item.consumptionType==="long_term_consumable"&&<label>{t("移动对象")}<select value={openedId} onChange={e=>setOpenedId(e.target.value)}><option value="">{t("未开封库存")}</option>{availableOpened.map(row=><option key={row.id} value={row.id}>{t("已开封")} · {row.openedAt.slice(0,10)} · {row.quantity} {displayUnit(item.baseUnit)}</option>)}</select></label>}
 {!openedId&&<BatchSelect key={source} homeId={getHomeId()} itemId={item.id} locationId={source}/>}
 <label>{t("移动数量")}<input type="number" min="0.01" step="0.01" required value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><p className="muted">{t("保留原批次、成本和开封日期，不计入采购或消耗。")}</p></fieldset>{error&&<p className="setup-error" role="alert">{error}</p>}<button className="primary full" disabled={busy||loading||!target||target===source}>{busy?t("处理中…"):t("确认移动")}</button></form></WorkflowDialog>;
}

type CountRow={itemId:string;name:string;unit:string;quantity:number};
export function StocktakeDialog({locations,onClose,onSaved}:Common){
 const {t}=useTranslation();const [location,setLocation]=useState(locations[0]?.id||"");const [rows,setRows]=useState<CountRow[]>([]),[counts,setCounts]=useState<Record<string,string>>({});
 const [review,setReview]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[refresh,setRefresh]=useState(0);
 const key=useRef(crypto.randomUUID()),saving=useRef(false);
 useEffect(()=>{const c=new AbortController();setLoading(true);setReview(false);setCounts({});setError("");key.current=crypto.randomUUID();if(!location){setRows([]);setLoading(false);return;}
 apiFetch(`/api/v1/homes/${getHomeId()}/stocktake/${location}`,{signal:c.signal}).then(bodyOrError).then(data=>{if(!c.signal.aborted){setRows(data.items);setLoading(false);}}).catch(e=>{if(!c.signal.aborted){setError(e.message);setRows([]);setLoading(false);}});return()=>c.abort();},[location,refresh]);
 const counted=rows.filter(row=>counts[row.itemId]?.trim());
 const changes=counted.filter(row=>roundQuantity(Number(counts[row.itemId]))!==row.quantity);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!review){setReview(true);return;}if(saving.current)return;saving.current=true;setBusy(true);setError("");
 try{await bodyOrError(await apiJson(`/api/v1/homes/${getHomeId()}/stocktake`,"POST",{locationId:location,idempotencyKey:key.current,rows:counted.map(row=>({itemId:row.itemId,expectedQuantity:row.quantity,countedQuantity:Number(counts[row.itemId])}))}));onSaved();onClose();}
 catch(e){setError(e instanceof Error?e.message:String(e));}finally{saving.current=false;setBusy(false);}}
 return <WorkflowDialog title={t("按地点盘点")} onClose={onClose} busy={busy}><form onSubmit={submit}><label>{t("存放地点")}<select value={location} disabled={busy} onChange={e=>setLocation(e.target.value)}>{locations.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><p className="muted">{t("仅盘点当前地点，不包含子地点；空白项跳过，填 0 表示已无库存。")}</p>
 {loading?<p role="status">{t("加载中…")}</p>:<div className="workflow-table"><table><thead><tr><th>{t("物资")}</th><th>{t("账面数量")}</th><th>{t("实盘数量")}</th><th>{t("差异")}</th></tr></thead><tbody>{(review?counted:rows).map(row=><tr key={row.itemId}><td>{row.name}<small>{displayUnit(row.unit)}</small></td><td>{row.quantity}</td><td>{review?counts[row.itemId]:<input aria-label={`${row.name} ${t("实盘数量")}`} type="number" min="0" step="0.01" value={counts[row.itemId]??""} onChange={e=>{setCounts({...counts,[row.itemId]:e.target.value});key.current=crypto.randomUUID();}}/>}</td><td>{counts[row.itemId]?.trim()?roundQuantity(Number(counts[row.itemId])-row.quantity):"—"}</td></tr>)}</tbody></table>{!rows.length&&<p className="empty">{t("暂无库存")}</p>}</div>}
 {review&&<p>{t("已填写 {{count}} 项，差异 {{changes}} 项",{count:counted.length,changes:changes.length})}</p>}
 {error&&<p className="setup-error" role="alert">{error} <button type="button" disabled={busy} onClick={()=>setRefresh(x=>x+1)}>{t("重新加载")}</button></p>}
 <div className="delete-dialog-actions">{review&&<button className="secondary" type="button" disabled={busy} onClick={()=>setReview(false)}>{t("返回修改")}</button>}<button className="primary" disabled={loading||busy||!counted.length}>{busy?t("处理中…"):review?t("确认盘点"):t("预览差异")}</button></div></form></WorkflowDialog>;
}

type Operation={id:string;kind:string;createdAt:string;summary:string;undoneAt:string|null;canUndo:boolean};
export function OperationHistoryDialog({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}){
 const {t}=useTranslation();const [rows,setRows]=useState<Operation[]>([]),[refresh,setRefresh]=useState(0),[selected,setSelected]=useState<Operation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");const saving=useRef(false);
 useEffect(()=>{const c=new AbortController();apiFetch(`/api/v1/homes/${getHomeId()}/stock/operations`,{signal:c.signal}).then(bodyOrError).then(data=>{if(!c.signal.aborted)setRows(data.items);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[refresh]);
 const labels:Record<string,string>={receipt:t("入库"),issue:t("领用 / 开封"),purchase:t("采购入库"),transfer:t("移动库存"),reconcile:t("盘点调整"),stocktake:t("按地点盘点"),"exhaust-opened":t("用尽")};
 async function undo(){if(!selected||saving.current)return;saving.current=true;setBusy(true);setError("");try{await bodyOrError(await apiJson(`/api/v1/homes/${getHomeId()}/stock/operations/${selected.id}/undo`,"POST",{}));setSelected(null);setRefresh(x=>x+1);onSaved();}catch(e){setError(e instanceof Error?e.message:String(e));setRefresh(x=>x+1);}finally{saving.current=false;setBusy(false);}}
 return <WorkflowDialog title={t("撤销库存操作")} onClose={onClose} busy={busy}><p className="muted">{t("显示升级后最近 30 次库存操作。撤销保留流水；有后续变动时不可直接撤销。")}</p>{selected?<div><h3>{labels[selected.kind]??selected.kind} · {selected.summary}</h3><p>{t("将恢复本次操作前的库存、开封状态和采购待收数量，并重算成本。")}</p><div className="delete-dialog-actions"><button className="secondary" disabled={busy} onClick={()=>setSelected(null)}>{t("取消")}</button><button className="primary" disabled={busy} onClick={()=>void undo()}>{t("确认撤销")}</button></div></div>:<div className="workflow-history">{rows.map(row=><div key={row.id}><div><strong>{labels[row.kind]??row.kind} · {row.summary}</strong><small>{new Date(row.createdAt).toLocaleString()}</small></div>{row.undoneAt?<span>{t("已撤销")}</span>:<button type="button" className="text-button" disabled={!row.canUndo||busy} onClick={()=>setSelected(row)}>{row.canUndo?t("撤销"):t("已有后续变动")}</button>}</div>)}{!rows.length&&<p className="empty">{t("暂无可撤销记录")}</p>}</div>}{error&&<p className="setup-error" role="alert">{error}</p>}</WorkflowDialog>;
}
