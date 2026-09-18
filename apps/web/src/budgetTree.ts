export type BudgetCategory = { id: string; parentId: string | null; name: string };
export type CategorySpending = { category: string; actual: number; planned: number };
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
