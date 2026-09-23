import type {MouseEvent,ReactNode} from "react";

export function LocationLink({locationId,children}:{locationId:string|null|undefined;children:ReactNode}){
 if(!locationId)return <>{children}</>;
 const href=`/locations#stocktake=${locationId}`;
 function navigate(event:MouseEvent<HTMLAnchorElement>){
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  window.history.pushState(null,"",href);
  window.dispatchEvent(new PopStateEvent("popstate"));
 }
 return <a className="location-link" href={href} onClick={navigate}>{children}</a>;
}
