export function localToday(now=new Date()):string {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}
export function isPurchaseOverdue(item:{plannedDate?:string|null;completed?:boolean|number},today=localToday()):boolean {
  return !item.completed&&!!item.plannedDate&&item.plannedDate<today;
}
export function adjacentMonth(month:string,offset:number):string {
  const [year,value]=month.split("-").map(Number);
  const date=new Date(Date.UTC(year,value-1+offset,1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;
}
