import { useState } from "react";

export function BatchFields({ manufacturedDate = "", expiryDate = "", title = "本批次日期（可选）" }: { manufacturedDate?: string; expiryDate?: string; title?: string }) {
  const [date,setDate]=useState(manufacturedDate),[amount,setAmount]=useState(""),[unit,setUnit]=useState("day"),[expiry,setExpiry]=useState(expiryDate);
  function calculate(nextDate:string,nextAmount:string,nextUnit:string) {
    if(!nextDate||!nextAmount)return;
    const value=Number(nextAmount);if(!Number.isInteger(value)||value<=0)return;
    const result=new Date(`${nextDate}T12:00:00`);
    if(nextUnit==="day")result.setDate(result.getDate()+value);
    else {const day=result.getDate();result.setDate(1);result.setMonth(result.getMonth()+value*(nextUnit==="year"?12:1));const last=new Date(result.getFullYear(),result.getMonth()+1,0).getDate();result.setDate(Math.min(day,last));}
    setExpiry(`${result.getFullYear()}-${String(result.getMonth()+1).padStart(2,"0")}-${String(result.getDate()).padStart(2,"0")}`);
  }
  return <fieldset className="batch-dates"><legend>{title}</legend><div className="form-row">
    <label>生产日期<input name="manufacturedDate" type="date" value={date} onChange={event=>{setDate(event.target.value);calculate(event.target.value,amount,unit);}} /></label>
    <label>保质期<div className="form-row"><input aria-label="保质期时长" type="number" min="1" step="1" value={amount} onChange={event=>{setAmount(event.target.value);calculate(date,event.target.value,unit);}} /><select aria-label="保质期单位" value={unit} onChange={event=>{setUnit(event.target.value);calculate(date,amount,event.target.value);}}><option value="day">天</option><option value="month">月</option><option value="year">年</option></select></div></label>
  </div><label>到期日期<input name="expiryDate" type="date" min={date||undefined} value={expiry} onChange={event=>setExpiry(event.target.value)} /></label><small className="muted">可填写生产日期与时长自动计算，也可直接填写到期日期。不会影响其他批次。</small></fieldset>;
}
