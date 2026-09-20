import {useTranslation} from "react-i18next";

export function PageSizeSelect({value,onChange,options=[10,20,50,100]}:{value:number;onChange:(size:number)=>void;options?:readonly number[]}) {
  const {t}=useTranslation();
  return <label className="page-size-select">{t("每页")}<select value={value} onChange={event=>onChange(Number(event.target.value))}>{options.map(size=><option key={size} value={size}>{size}</option>)}</select></label>;
}
