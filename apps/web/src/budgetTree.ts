export type BudgetCategory = { id: string; parentId: string | null; name: string };
export type CategorySpending = { category: string; actual: number; planned: number };
export type BudgetAllocation = {category:string;amount:number|string};

// Materialize missing ancestors so every allocation has a place in the tree.
export function completeBudgetTree(categories:BudgetCategory[],entries:BudgetAllocation[]):BudgetAllocation[] {
  const values=new Map(entries.map(entry=>[entry.category,Math.round((Number(entry.amount)||0)*100)]));
  const paths=entries.flatMap(entry=>categoryPath(entry.category,categories));
  for(const name of [...new Set(paths)].sort((a,b)=>categoryPath(b,categories).length-categoryPath(a,categories).length)) {
    if(!values.has(name))values.set(name,[...values].filter(([child])=>categoryPath(child,categories).at(-2)===name).reduce((sum,[,amount])=>sum+amount,0));
  }
  return [...values].map(([category,amount])=>({category,amount:amount/100}));
}

export function setBudgetAllocation(categories:BudgetCategory[],entries:BudgetAllocation[],category:string,amount:string) {
  const rows=completeBudgetTree(categories,entries);
  const previous=Number(rows.find(row=>row.category===category)?.amount)||0;
  const delta=Math.round((Number(amount)||0)*100)-Math.round(previous*100);
  const ancestors=categoryPath(category,categories).slice(0,-1);
  const values=new Map(rows.map(row=>[row.category,Number(row.amount)]));
  values.set(category,Number(amount)||0);
  for(const parent of ancestors)values.set(parent,((Math.round((values.get(parent)||0)*100))+delta)/100);
  return [...values].map(([name,value])=>({category:name,amount:name===category?amount:value.toFixed(2)}));
}

export function removeBudgetAllocation(categories:BudgetCategory[],entries:BudgetAllocation[],category:string) {
  const rows=setBudgetAllocation(categories,entries,category,"0");
  return rows.filter(row=>!categoryPath(row.category,categories).includes(category));
}

export function budgetAllocations(categories:BudgetCategory[],entries:BudgetAllocation[]) {
  entries=completeBudgetTree(categories,entries);
  const names=new Set(entries.map(entry=>entry.category));
  const rows=entries.map(entry=>{
    const path=categoryPath(entry.category,categories);
    const parent=[...path].reverse().slice(1).find(name=>names.has(name))??null;
    return {...entry,amount:Number(entry.amount)||0,path,parent,allocated:0,unallocated:0};
  });
  for(const row of rows) {
    const minor=rows.filter(child=>child.parent===row.category).reduce((sum,child)=>sum+Math.round(child.amount*100),0);
    row.allocated=minor/100;
    row.unallocated=(Math.round(row.amount*100)-minor)/100;
  }
  return {rows,total:rows.filter(row=>row.parent===null).reduce((sum,row)=>sum+Math.round(row.amount*100),0)/100};
}
export type BudgetNode = {
  name: string;
  path: string[];
  directActual: number;
  directPlanned: number;
  actual: number;
  planned: number;
  children: BudgetNode[];
};

export function categoryPath(name: string, categories: BudgetCategory[]): string[] {
  const path = [name], seen = new Set<string>();
  let row = categories.find(category => category.name === name);
  while (row && !seen.has(row.id)) {
    seen.add(row.id);
    row = categories.find(category => category.id === row?.parentId);
    if (row && !seen.has(row.id)) path.unshift(row.name);
  }
  return path;
}

export function buildBudgetTree(categories: BudgetCategory[], spending: CategorySpending[]): BudgetNode[] {
  const names = new Set([...categories.map(row => row.name), ...spending.map(row => row.category)]);
  const nodes = new Map<string, BudgetNode>();
  for (const name of names) {
    const direct = spending.filter(row => row.category === name);
    nodes.set(name, {name, path: categoryPath(name, categories), directActual: direct.reduce((sum,row)=>sum+row.actual,0), directPlanned: direct.reduce((sum,row)=>sum+row.planned,0), actual:0, planned:0, children:[]});
  }
  const roots: BudgetNode[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.path.at(-2) ?? "");
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const total = (node: BudgetNode) => {
    node.children.forEach(total);
    node.actual = node.directActual + node.children.reduce((sum,child)=>sum+child.actual,0);
    node.planned = node.directPlanned + node.children.reduce((sum,child)=>sum+child.planned,0);
  };
  roots.forEach(total);
  return roots;
}
