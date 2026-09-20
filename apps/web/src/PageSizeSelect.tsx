import {useTranslation} from "react-i18next";

export function PageSizeSelect({value,onChange}:{value:number;onChange:(size:number)=>void}) {
  const {t}=useTranslation();
  return <label className="page-size-select">{t("每页")}<select value={value} onChange={event=>onChange(Number(event.target.value))}>{[10,20,50,100].map(size=><option key={size} value={size}>{size}</option>)}</select></label>;
}
