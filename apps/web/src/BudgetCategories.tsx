import { useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildBudgetTree, budgetAllocations, categoryPath, type BudgetCategory, type BudgetNode, type CategorySpending } from "./budgetTree.js";
import "./budgetCategories.css";

type Allocation = {category:string;amount: number|string};

export function BudgetCategoryPicker({categories,entries,value,onChange}:{categories:BudgetCategory[];entries:Allocation[];value:string;onChange:(value:string)=>void}) {
  const {t}=useTranslation();
  const dropdown=useRef<HTMLDetailsElement>(null);
  const render=(node:BudgetNode,depth=0):React.ReactNode=>{
    return <div key={node.name}>
      <button type="button" style={{paddingLeft:12+depth*16}} title={node.path.join(" / ")} onClick={()=>{onChange(node.name);if(dropdown.current)dropdown.current.open=false;}}>
        <span>{depth>0?"└ ":""}{node.name}</span>
      </button>
      {node.children.map(child=>render(child,depth+1))}
    </div>;
  };
  return <details className="budget-tree-picker" ref={dropdown}>
    <summary>{value?categoryPath(value,categories).join(" / "):t("选择分类")}</summary>
    <div className="budget-tree-options" aria-label={t("选择分类")}>{buildBudgetTree(categories,[]).map(node=>render(node))}</div>
  </details>;
}

export function BudgetCategoryLabel({name,categories}:{name:string;categories:BudgetCategory[]}) {
  const path=categoryPath(name,categories);
  return <span className="budget-category-label" title={path.join(" / ")}><b>{name}</b>{path.length>1&&<small>{path.slice(0,-1).join(" / ")}</small>}</span>;
}

export function BudgetAllocationEditor({categories,entries,currency,onChange,onRemove,entryRef}:{categories:BudgetCategory[];entries:Allocation[];currency:string;onChange:(category:string,amount:string)=>void;onRemove:(category:string)=>void;entryRef:(category:string,node:HTMLDivElement|null)=>void}) {
  const {t,i18n}=useTranslation();
  const money=(value:number)=>new Intl.NumberFormat(i18n.language,{style:"currency",currency}).format(value);
  const {rows}=budgetAllocations(categories,entries);
  const render=(row:typeof rows[number]):React.ReactNode=>{
    const children=rows.filter(child=>child.parent===row.category);
    return <div className="budget-allocation-node" key={row.category}>
      <div className="category-budget-entry" ref={node=>entryRef(row.category,node)}>
        <span className="budget-category-label"><b>{row.category}</b>{children.length>0&&<small>{t("合计")}</small>}</span>
        <input aria-label={t("{{category}}预算",{category:row.category})} value={entries.find(entry=>entry.category===row.category)?.amount??row.amount.toFixed(2)} onChange={event=>onChange(row.category,event.target.value)} type="number" min="0" step="0.01"/>
        <button type="button" aria-label={t("移除{{name}}",{name:row.category})} onClick={()=>onRemove(row.category)}><X size={14}/></button>
      </div>
      {children.length>0&&<>
        {row.unallocated<0&&<small className="allocation-error" role="alert">{t("子分类额度超过{{category}}预算",{category:row.category})}</small>}
        <div className="budget-allocation-children">{children.map(render)}{row.unallocated!==0&&<div className="allocation-split"><span>{row.category}</span><b>{money(row.unallocated)}</b></div>}</div>
      </>}
    </div>;
  };
  return <>{rows.filter(row=>row.parent===null).map(render)}</>;
}

export function BudgetExecution({categories,spending,budgets,currency}:{categories:BudgetCategory[];spending:CategorySpending[];budgets:{category:string;amount:number}[];currency:string}) {
  const {t,i18n}=useTranslation();
  const money=(value:number)=>new Intl.NumberFormat(i18n.language,{style:"currency",currency}).format(value);
  const tree=buildBudgetTree(categories,spending);
  const allocations=budgetAllocations(categories,budgets);
  const limits=new Map(allocations.rows.map(row=>[row.category,row.amount]));
  const hasBudget=(node:BudgetNode):boolean=>limits.has(node.name)||node.children.some(hasBudget);
  const find=(nodes:BudgetNode[],name:string):BudgetNode|undefined=>{
    for(const node of nodes){if(node.name===name)return node;const found=find(node.children,name);if(found)return found;}
  };
  const amounts=(actual:number,planned:number,remaining?:number)=><div className="budget-tree-amounts"><span>{t("已花")} <b>{money(actual)}</b></span><span>{t("待采购")} <b>{money(planned)}</b></span>{remaining!==undefined&&<span className={remaining<0?"budget-tree-over":"budget-tree-remaining"}>{remaining<0?t("超支"):t("剩余")} {money(Math.abs(remaining))}</span>}</div>;
  const render=(node:BudgetNode,depth:number,unbudgeted=false):React.ReactNode=>{
    const budget=unbudgeted?undefined:limits.get(node.name);
    const children=node.children.filter(child=>child.actual>0||child.planned>0||(!unbudgeted&&hasBudget(child)));
    const allocation=allocations.rows.find(row=>row.category===node.name);
    const childBudgets=allocations.rows.filter(row=>row.parent===node.name);
    const reservedActual=childBudgets.reduce((sum,row)=>sum+(find(tree,row.category)?.actual??0),0);
    const reservedPlanned=childBudgets.reduce((sum,row)=>sum+(find(tree,row.category)?.planned??0),0);
    const flexibleRemaining=allocation?allocation.unallocated-(node.actual-reservedActual)-(node.planned-reservedPlanned):0;
    const hasDetails=children.length>0;
    const forecast=node.actual+node.planned,remaining=(budget??0)-forecast,max=Math.max(1,budget??0,forecast);
    const content=<>
      <span className="budget-tree-heading"><strong>{node.name}</strong>{budget!==undefined&&<small>{t("预算")} {money(budget)}</small>}</span>
      {amounts(node.actual,node.planned,budget!==undefined?remaining:undefined)}
      {budget!==undefined&&<span className="category-execution-bar"><i style={{width:node.actual/max*100+"%"}}/><em style={{width:node.planned/max*100+"%"}}/></span>}
      {budget!==undefined&&childBudgets.length>0&&<div className={flexibleRemaining<0?"allocation-split invalid":"allocation-split"}><span>{node.name} {money(allocation!.unallocated)}</span><span>{flexibleRemaining<0?t("超支"):t("可用")} {money(Math.abs(flexibleRemaining))}</span></div>}
    </>;
    return <div className="budget-spend-node" key={node.name}>
      {hasDetails?<details open={depth===0}><summary>{content}</summary>
        <div className="budget-tree-children">
          {(node.directActual>0||node.directPlanned>0)&&<div className="budget-direct"><small>{t("本分类直接支出")}</small>{amounts(node.directActual,node.directPlanned)}</div>}
          {children.map(child=>render(child,depth+1,unbudgeted))}
        </div>
      </details>:<div className="budget-spend-leaf">{content}</div>}
    </div>;
  };
  const outside=spending.filter(row=>!allocations.rows.some(budget=>categoryPath(row.category,categories).includes(budget.category)));
  const unbudgeted=buildBudgetTree(categories,outside).filter(node=>node.actual>0||node.planned>0);
  return <section className="panel finance-bars finance-category-spending">
    <div className="panel-head"><div><h2>{t("分类预算执行")}</h2></div></div>
    <div className="budget-execution-tree">
      {budgets.length?allocations.rows.filter(row=>row.parent===null).map(budget=>{
        const node=find(tree,budget.category)??{name:budget.category,path:[budget.category],actual:0,planned:0,directActual:0,directPlanned:0,children:[]};
        return render(node,0);
      }):<p className="empty">{t("尚未分配分类预算")}</p>}
      {unbudgeted.length>0&&<div className="unbudgeted-category-group"><small>{t("计划外支出")}</small>{unbudgeted.map(node=>render(node,0,true))}</div>}
    </div>
  </section>;
}
