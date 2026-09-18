import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { buildBudgetTree, categoryPath, type BudgetCategory, type BudgetNode, type CategorySpending } from "./budgetTree.js";
import "./budgetCategories.css";

type Allocation = {category:string;amount: number|string};

export function BudgetCategoryPicker({categories,entries,value,onChange}:{categories:BudgetCategory[];entries:Allocation[];value:string;onChange:(value:string)=>void}) {
  const {t}=useTranslation();
  const dropdown=useRef<HTMLDetailsElement>(null);
  const render=(node:BudgetNode,depth=0):React.ReactNode=>{
    const owner=entries.find(entry=>node.path.includes(entry.category));
    const descendant=entries.find(entry=>categoryPath(entry.category,categories).slice(0,-1).includes(node.name));
    const disabled=Boolean(owner||descendant);
    return <div key={node.name}>
      <button type="button" disabled={disabled} style={{paddingLeft:12+depth*16}} title={node.path.join(" / ")} onClick={()=>{onChange(node.name);if(dropdown.current)dropdown.current.open=false;}}>
        <span>{depth>0?"└ ":""}{node.name}</span>
        <small>{owner?t("共享{{category}}预算",{category:owner.category}):descendant?t("子分类已分配预算"):t("可分配")}</small>
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
  const {t}=useTranslation();
  const path=categoryPath(name,categories);
  return <span className="budget-category-label" title={path.join(" / ")}><b>{name}</b><small>{path.length>1?path.slice(0,-1).join(" / "):t("一级分类")}</small><small>{t("覆盖全部子分类")}</small></span>;
}

export function BudgetExecution({categories,spending,budgets,currency}:{categories:BudgetCategory[];spending:CategorySpending[];budgets:{category:string;amount:number}[];currency:string}) {
  const {t,i18n}=useTranslation();
  const money=(value:number)=>new Intl.NumberFormat(i18n.language,{style:"currency",currency}).format(value);
  const tree=buildBudgetTree(categories,spending);
  const find=(nodes:BudgetNode[],name:string):BudgetNode|undefined=>{
    for(const node of nodes){if(node.name===name)return node;const found=find(node.children,name);if(found)return found;}
  };
  const amounts=(actual:number,planned:number)=><div className="budget-tree-amounts"><span>{t("已花")} <b>{money(actual)}</b></span><span>{t("待采购")} <b>{money(planned)}</b></span></div>;
  const render=(node:BudgetNode,owner:string|null,depth:number,budget?:number):React.ReactNode=>{
    const children=node.children.filter(child=>child.actual>0||child.planned>0);
    const hasDetails=children.length>0;
    const forecast=node.actual+node.planned,remaining=(budget??0)-forecast,max=Math.max(1,budget??0,forecast);
    const content=<>
      <span className="budget-tree-heading"><strong>{node.name}</strong><small>{budget!==undefined?t("共享预算"):owner?t("共享{{category}}预算",{category:owner}):t("未分配预算")}{budget!==undefined?" "+money(budget):""}</small></span>
      {amounts(node.actual,node.planned)}
      {budget!==undefined&&<><span className="category-execution-bar"><i style={{width:node.actual/max*100+"%"}}/><em style={{width:node.planned/max*100+"%"}}/><b style={{left:(budget/max*100)+"%"}}/></span><span className={remaining<0?"budget-tree-over":"budget-tree-remaining"}>{remaining<0?t("超支"):t("剩余")} {money(Math.abs(remaining))}</span></>}
    </>;
    return <div className="budget-spend-node" key={node.name}>
      {hasDetails?<details open={depth===0}><summary>{content}</summary>
        <div className="budget-tree-children">
          {(node.directActual>0||node.directPlanned>0)&&<div className="budget-direct"><small>{t("本分类直接支出")}</small>{amounts(node.directActual,node.directPlanned)}</div>}
          {children.map(child=>render(child,owner,depth+1))}
        </div>
      </details>:<div className="budget-spend-leaf">{content}</div>}
    </div>;
  };
  const outside=spending.filter(row=>!budgets.some(budget=>categoryPath(row.category,categories).includes(budget.category)));
  const unbudgeted=buildBudgetTree(categories,outside).filter(node=>node.actual>0||node.planned>0);
  return <section className="panel finance-bars finance-category-spending">
    <div className="panel-head"><div><h2>{t("分类预算执行")}</h2><p className="muted">{t("展开分类查看子孙分类支出")}</p></div></div>
    <div className="budget-execution-tree">
      {budgets.length?budgets.map(budget=>{
        const node=find(tree,budget.category)??{name:budget.category,path:[budget.category],actual:0,planned:0,directActual:0,directPlanned:0,children:[]};
        return render(node,budget.category,0,budget.amount);
      }):<p className="empty">{t("尚未分配分类预算")}</p>}
      {unbudgeted.length>0&&<div className="unbudgeted-category-group"><small>{t("计划外支出")}</small>{unbudgeted.map(node=>render(node,null,0))}</div>}
    </div>
  </section>;
}
