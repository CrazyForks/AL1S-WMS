import {useState} from "react";
import i18n from "./i18n/index.js";
import type {Item} from "./webTypes.js";
const t=i18n.t.bind(i18n);

export function ConsumptionFields({consumptionType="consumable",openedShelfLifeDays,disabled=false}:{consumptionType?:Item["consumptionType"];openedShelfLifeDays?:number|null;disabled?:boolean}){
  const [type,setType]=useState(consumptionType);
  const [days,setDays]=useState(String(openedShelfLifeDays??""));
  const applicable=type==="long_term_consumable";
  return <div className="form-row">
    <label>{t("消耗类型")}<select name="consumptionType" value={type} onChange={event=>setType(event.target.value as Item["consumptionType"])} disabled={disabled}>
      <option value="consumable">{t("消耗品")}</option>
      <option value="non_consumable">{t("非消耗品")}</option>
      <option value="long_term_consumable">{t("长期消耗品")}</option>
    </select></label>
    <label>{t("开封后保质期（天）")}<input name="openedShelfLifeDays" type={applicable?"number":"text"} min={applicable?1:undefined} step={applicable?1:undefined} value={applicable?days:"--"} onChange={event=>setDays(event.target.value)} disabled={disabled||!applicable} placeholder={applicable?t("可选"):undefined}/></label>
  </div>;
}
