import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { BatchFields } from "./BatchFields.js";

export type Batch = {batchId:string;itemId:string;label:string|null;locationId:string;locationName:string;quantity:number;manufacturedDate:string|null;expiryDate:string|null;receivedAt:string;legacy:number};
export function Batches({homeId,item,onClose,onChange}:{homeId:string;item:{id:string;name:string;baseUnit:string};onClose:()=>void;onChange:()=>void}) {
  const [rows,setRows]=useState<Batch[]>([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[includeEmpty,setIncludeEmpty]=useState(false),[edit,setEdit]=useState<Batch|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{const controller=new AbortController();setError("");fetch(`/api/v1/homes/${homeId}/batches?itemId=${item.id}&includeEmpty=${includeEmpty}&limit=10&offset=${(page-1)*10}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("无法加载批次");return response.json();}).then(data=>{setRows(data.items);setTotal(data.total);}).catch(error=>{if(error.name!=="AbortError")setError(error.message);});return()=>controller.abort();},[homeId,item.id,page,includeEmpty,revision]);
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!edit||busy)return;setBusy(true);setError("");const data=new FormData(event.currentTarget);
    try {const response=await fetch(`/api/v1/homes/${homeId}/batches/${edit.batchId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:data.get("label")||null,manufacturedDate:data.get("manufacturedDate")||null,expiryDate:data.get("expiryDate")||null})});const result=await response.json();if(!response.ok)throw new Error(result.message||"保存失败");setEdit(null);setRevision(value=>value+1);onChange();}catch(error){setError(error instanceof Error?error.message:"保存失败");}finally{setBusy(false);}
  }
  return <div className="modal-backdrop"><section className="modal batches-modal" role="dialog" aria-modal="true" aria-labelledby="batches-title">
    <div className="modal-head"><div><h2 id="batches-title">{item.name} · 库存批次</h2><p className="muted">同一批次可分布在多个地点；日期独立管理。</p></div><button className="close" aria-label="关闭" onClick={onClose}><X size={18}/></button></div>
    {error&&<p className="setup-error" role="alert">{error}</p>}
    {edit ? <form onSubmit={save}>
      <label>批次备注<input name="label" maxLength={100} defaultValue={edit.label||""}/></label>
      <BatchFields manufacturedDate={edit.manufacturedDate||""} expiryDate={edit.expiryDate||""}/>
      <div className="delete-dialog-actions"><button className="secondary" type="button" onClick={()=>setEdit(null)}>返回批次</button><button className="primary" disabled={busy}>保存批次</button></div>
    </form> : <>
      <div className="batch-toolbar">
        <div><strong>显示范围</strong><small>{includeEmpty ? "全部批次，包括库存为 0" : "仅显示当前有库存的批次"}</small></div>
        <label className="batch-toggle">
          <input type="checkbox" checked={includeEmpty} onChange={event=>{setIncludeEmpty(event.target.checked);setPage(1);}}/>
          <span aria-hidden="true"/><b>显示已用完</b>
        </label>
      </div>
      <div className="table-wrap"><table><thead><tr><th>批次</th><th>地点</th><th>剩余</th><th>生产 / 到期</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={`${row.batchId}:${row.locationId}`}><td>{row.label||new Date(row.receivedAt).toLocaleString("zh-CN")}{row.legacy?<small className="muted">（历史库存）</small>:null}</td><td>{row.locationName||"未指定"}</td><td>{row.quantity} {item.baseUnit}</td><td><div className="date-cell"><span>{row.manufacturedDate||"未设置"}</span><span>{row.expiryDate||"未设置"}</span></div></td><td><button className="text-button" onClick={()=>setEdit(row)}>编辑</button></td></tr>)}</tbody></table>{!rows.length&&<p className="empty">暂无批次</p>}</div>
      <div className="pagination"><span>共 {total} 条</span><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil(total/10))}</span><button disabled={page*10>=total} onClick={()=>setPage(page+1)}>下一页</button></div>
    </>}
  </section></div>;
}

export function BatchSelect({homeId,itemId,locationId}:{homeId:string;itemId:string;locationId:string}) {
  const [rows,setRows]=useState<Batch[]>([]),[offset,setOffset]=useState(0),[hasMore,setHasMore]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setRows([]);setOffset(0);},[itemId,locationId]);
  useEffect(()=>{const controller=new AbortController();setError("");fetch(`/api/v1/homes/${homeId}/batches?itemId=${itemId}&locationId=${locationId}&limit=100&offset=${offset}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("无法加载批次");return response.json();}).then(data=>{setRows(previous=>offset?[...previous,...data.items]:data.items);setHasMore(data.hasMore);}).catch(error=>{if(error.name!=="AbortError")setError(error.message);});return()=>controller.abort();},[homeId,itemId,locationId,offset]);
  return <><label>领用批次<select name="batchId" key={locationId}><option value="">自动分配：最早到期优先，无日期最后</option>{rows.map(row=><option key={row.batchId} value={row.batchId}>{row.label||new Date(row.receivedAt).toLocaleString("zh-CN")} · 剩余 {row.quantity} · {row.expiryDate||"无到期日"}</option>)}</select></label>{hasMore&&<button type="button" className="text-button" onClick={()=>setOffset(offset+100)}>加载更多批次</button>}{error&&<p className="setup-error">{error}</p>}</>;
}
