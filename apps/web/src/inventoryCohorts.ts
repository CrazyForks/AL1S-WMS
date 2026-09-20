export type CohortPoint={label:string;originalCost:number;usedCost:number;wastedCost:number;adjustmentCost:number;remainingCost:number;unknownCostBatchCount:number;usedShare:number|null};
export type CohortGrain="month"|"quarter"|"year";

export function groupCohorts(points:CohortPoint[],grain:CohortGrain):CohortPoint[]{
  const groups=new Map<string,CohortPoint>();
  const amounts=["originalCost","usedCost","wastedCost","adjustmentCost","remainingCost"] as const;
  for(const point of points){
    const label=grain==="month"?point.label:grain==="year"?point.label.slice(0,4):`${point.label.slice(0,4)} Q${Math.ceil(Number(point.label.slice(5,7))/3)}`;
    const row=groups.get(label)??{label,originalCost:0,usedCost:0,wastedCost:0,adjustmentCost:0,remainingCost:0,unknownCostBatchCount:0,usedShare:null};
    for(const key of amounts)row[key]=(Math.round(row[key]*100)+Math.round(point[key]*100))/100;
    row.unknownCostBatchCount+=point.unknownCostBatchCount;
    row.usedShare=row.originalCost>0?Math.round(row.usedCost/row.originalCost*10000)/100:null;
    groups.set(label,row);
  }
  return [...groups.values()];
}
