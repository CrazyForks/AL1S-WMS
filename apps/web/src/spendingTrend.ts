export function spendingTrendScale(points:{actual:number;planned:number;budget:number|null}[]):number {
  const budget=Math.max(0,...points.map(point=>point.budget??0));
  const forecast=Math.max(0,...points.map(point=>point.actual+point.planned));
  if(budget===0)return forecast>0?forecast/0.75:1;
  const ceiling=budget/0.75;
  return forecast>ceiling?forecast/0.95:ceiling;
}
