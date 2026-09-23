import {useId,useRef,type ReactNode} from "react";
import {ChevronDown} from "lucide-react";
import {useTranslation} from "react-i18next";

export function InventoryMoreActions({children}:{children:ReactNode}) {
  const {t}=useTranslation();
  const id=useId(),menu=useRef<HTMLDivElement>(null);
  return <>
    <button type="button" className="inventory-more-trigger" aria-label={t("更多操作")} title={t("更多操作")} popoverTarget={id} onClick={event=>{
      const rect=event.currentTarget.getBoundingClientRect();
      const element=menu.current!;
      element.style.left=`${Math.max(8,Math.min(rect.right-112,window.innerWidth-120))}px`;
      element.style.top=`${rect.bottom+168>window.innerHeight?Math.max(8,rect.top-168):rect.bottom+4}px`;
    }}><ChevronDown size={15}/></button>
    <div ref={menu} id={id} popover="auto" className="inventory-more-menu" onClick={event=>{
      if((event.target as HTMLElement).closest("button"))menu.current?.hidePopover();
    }}>{children}</div>
  </>;
}
