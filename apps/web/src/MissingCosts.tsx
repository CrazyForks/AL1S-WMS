import {PageSizeSelect} from "./PageSizeSelect.js";
import {useEffect,useLayoutEffect,useRef,useState,type FormEvent} from "react";
import {useTranslation} from "react-i18next";
import {apiFetch} from "./i18n/apiFetch.js";
import {displayUnit} from "./i18n/index.js";

type MissingBatch={batchId:string;itemId:string;itemName:string;unit:string;label:string|null;receivedAt:string;quantity:number;remainingQuantity:number;legacy:number;issueCount:number};
type MissingReport={currency:string;total:number;page:number;totalPages:number;items:MissingBatch[]};

function CostDialog({homeId,batch,currency,onClose,onSaved}:{homeId:string;batch:MissingBatch;currency:string;onClose:()=>void;onSaved:()=>void}) {
  const {t}=useTranslation();
  const dialog=useRef<HTMLDialogElement>(null);
  const saving=useRef(false);
  const [amount,setAmount]=useState("");
  const amountInput=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useLayoutEffect(()=>{
    const node=dialog.current!;
    const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const {scrollX,scrollY}=window;
    node.showModal();
    amountInput.current?.focus({preventScroll:true});
    // Opening a native dialog must not move the underlying finance page.
    window.scrollTo({left:scrollX,top:scrollY,behavior:"instant"});
    return ()=>{
      node.close();
      if(trigger?.isConnected)trigger.focus({preventScroll:true});
    };
  },[]);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(saving.current)return;
    const value=String(new FormData(event.currentTarget).get("totalPrice")??"");
    if(!value.trim()||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>1_000_000_000)return;
    saving.current=true;setBusy(true);setError("");
    try {
      const response=await apiFetch(`/api/v1/homes/${homeId}/batches/${batch.batchId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({totalPrice:Number(value)})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.message||t("保存失败"));
    } catch(error) {
      setError(error instanceof Error?error.message:t("保存失败"));
      saving.current=false;setBusy(false);return;
    }
    onSaved();
  }
  return <dialog ref={dialog} className="modal missing-cost-dialog" aria-labelledby="cost-dialog-title" onCancel={event=>{event.preventDefault();if(!saving.current)onClose();}}>
    <div className="modal-head"><h2 id="cost-dialog-title">{t("补录成本")}</h2><button type="button" className="close" aria-label={t("关闭")} disabled={busy} onClick={onClose}>×</button></div>
    <p><strong>{batch.itemName}</strong></p><p className="muted">{batch.receivedAt.slice(0,10)} · {batch.label||batch.batchId.slice(0,8)}</p>
    <dl className="cost-dialog-quantities"><div><dt>{t(batch.legacy?"历史累计入库数量":"原始入库数量")}</dt><dd>{batch.quantity} {displayUnit(batch.unit)}</dd></div><div><dt>{t("当前剩余数量")}</dt><dd>{batch.remainingQuantity} {displayUnit(batch.unit)}</dd></div></dl>
    {!!batch.legacy&&<p className="muted">{t("历史库存由旧记录合并，可能包含多次入库；请填写这些入库记录的合计成本。")}</p>}
    <form onSubmit={save}>
      <label>{t("整批实付总价")} ({currency})<input ref={amountInput} value={amount} onChange={event=>setAmount(event.target.value)} name="totalPrice" type="number" required min="0" max="1000000000" step="0.01" placeholder="0.00" disabled={busy} aria-describedby="cost-dialog-hint"/></label>
      <p id="cost-dialog-hint" className="muted">{t("填写入库时整批的实际金额，非剩余库存金额；免费获得可填 0。")}</p>
      {amount!==""&&Number.isFinite(Number(amount))&&Number(amount)>=0&&batch.quantity>0&&<p className="cost-unit-preview">{t("折合单价")} {new Intl.NumberFormat(undefined,{style:"currency",currency,maximumFractionDigits:4}).format(Number(amount)/batch.quantity)} / {displayUnit(batch.unit)}</p>}
      {error&&<p className="setup-error" role="alert">{error}</p>}
      <div className="delete-dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>{t("取消")}</button><button type="submit" className="primary" disabled={busy}>{busy?t("保存中…"):t("保存")}</button></div>
    </form>
  </dialog>;
}

export function MissingCosts({homeId,revision,onSaved}:{homeId:string;revision:unknown;onSaved:()=>void}) {
  const {t}=useTranslation();
  const [pageSize,setPageSize]=useState(10);
  const [page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [data,setData]=useState<MissingReport|null>(null),[error,setError]=useState("");
  const [loading,setLoading]=useState(true),[editing,setEditing]=useState<MissingBatch|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");
    apiFetch(`/api/v1/homes/${homeId}/missing-costs?page=${page}&pageSize=${pageSize}`,{signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.message||String(response.status));return body as MissingReport;
    }).then(body=>{if(!controller.signal.aborted){setData(body);setLoading(false);}}).catch(error=>{if(!controller.signal.aborted){setError(error.message);setLoading(false);}});
    return ()=>controller.abort();
  },[homeId,revision,page,pageSize,refresh]);
  if(!error&&(!data||data.total===0))return null;
  return <section className="panel missing-cost-panel" aria-labelledby="missing-cost-title">
    <div className="panel-head cost-card-head"><div><h3 id="missing-cost-title">{t("成本缺失记录")}</h3><p>{t("按采购批次补录，包含已用完的批次")}</p></div>{data&&<span>{t("待补录 {{count}} 个批次",{count:data.total})}</span>}</div>
    {error?<p className="empty" role="alert">{error} <button type="button" onClick={()=>setRefresh(value=>value+1)}>{t("重试")}</button></p>:<>
      <div className="missing-cost-list" aria-busy={loading}>{data?.items.map(batch=><div className="missing-cost-entry" key={batch.batchId}><div><strong>{batch.itemName}</strong><small>{batch.receivedAt.slice(0,4)===String(new Date().getFullYear())?batch.receivedAt.slice(5,10):batch.receivedAt.slice(0,10)} · {t("入库")} {batch.quantity} {displayUnit(batch.unit)} · {t("剩余")} {batch.remainingQuantity} {displayUnit(batch.unit)}{batch.issueCount>0?` · ${t("出库 {{count}} 笔",{count:batch.issueCount})}`:""}</small>{batch.quantity<=0&&<small>{t("入库数量异常，需先核对库存记录")}</small>}</div><button type="button" className="text-button" disabled={loading||batch.quantity<=0} onClick={()=>setEditing(batch)}>{t("补录成本")}</button></div>)}</div>
      {data&&<div className="report-pagination"><PageSizeSelect value={pageSize} onChange={size=>{setPageSize(size);setPage(1);}}/><span>{data.page} / {data.totalPages}</span><button type="button" disabled={loading||data.page<=1} onClick={()=>setPage(data.page-1)}>{t("上一页")}</button><button type="button" disabled={loading||data.page>=data.totalPages} onClick={()=>setPage(data.page+1)}>{t("下一页")}</button></div>}
    </>}
    {editing&&data&&<CostDialog homeId={homeId} batch={editing} currency={data.currency} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setRefresh(value=>value+1);onSaved();}}/>}
  </section>;
}
