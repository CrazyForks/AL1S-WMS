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
  const limits=new Map(budgets.map(row=>[row.category,row.amount]));
  const palette=["#347e8b","#7785bb","#bd8957","#769960","#ac769c","#5d9fa8","#b87969"];
  const colorNames=[...new Set([...categories.map(row=>row.name),...spending.map(row=>row.category)])].sort();
  const color=(name:string)=>palette[Math.max(0,colorNames.indexOf(name))%palette.length];
  const owner=(name:string)=>[...categoryPath(name,categories)].reverse().find(name=>limits.has(name));
  const parent=(name:string)=>[...categoryPath(name,categories)].reverse().slice(1).find(name=>limits.has(name));
  const find=(nodes:BudgetNode[],name:string):BudgetNode|undefined=>{
    for(const node of nodes){if(node.name===name)return node;const found=find(node.children,name);if(found)return found;}
  };
  const hasSpending=(node:BudgetNode)=>node.actual!==0||node.planned!==0;
  const detailLine=(name:string,actual:number,planned:number)=><span className="execution-detail-line"><span>{name}</span><span className="execution-detail-values"><b>{money(actual)}</b>{planned!==0&&<small>{t("待采购")} {money(planned)}</small>}</span></span>;
  const renderDetail=(node:BudgetNode):React.ReactNode=>{
    const children=node.children.filter(hasSpending);
    return children.length?<details className="execution-detail-branch" key={node.name}>
      <summary>{detailLine(node.name,node.actual,node.planned)}</summary>
      <div className="execution-detail-children">
        {(node.directActual!==0||node.directPlanned!==0)&&<div>{detailLine(node.name,node.directActual,node.directPlanned)}</div>}
        {children.map(renderDetail)}
      </div>
    </details>:<div className="execution-detail-leaf" key={node.name}>{detailLine(node.name,node.actual,node.planned)}</div>;
  };
  const renderBudget=(budget:typeof budgets[number]):React.ReactNode=>{
    const node=find(tree,budget.category);
    const actual=node?.actual??0,planned=node?.planned??0;
    const remaining=(Math.round(budget.amount*100)-Math.round(actual*100)-Math.round(planned*100))/100;
    const scale=Math.max(1,budget.amount,actual+planned);
    const segments=node?[{name:node.name,actual:node.directActual,planned:node.directPlanned},...node.children.map(child=>({name:child.name,actual:child.actual,planned:child.planned}))]:[];
    const children=budgets.filter(child=>parent(child.category)===budget.category);
    const directTree=buildBudgetTree(categories,spending.filter(row=>owner(row.category)===budget.category));
    const direct=find(directTree,budget.category);
    const details=direct?.children.filter(hasSpending)??[];
    const hasDirect=!!direct&&(direct.directActual!==0||direct.directPlanned!==0)&&(children.length>0||details.length>0);
    const content=<>
      <span className="execution-budget-heading"><strong>{budget.category}</strong><span>{t("预算")} <b>{money(budget.amount)}</b></span></span>
      <span className="execution-budget-amounts"><span>{t("已花")} <b>{money(actual)}</b></span><span>{t("待采购")} <b>{money(planned)}</b></span><strong className={remaining<0?"execution-over":"execution-remaining"}>{remaining<0?t("超支"):t("剩余")} {money(Math.abs(remaining))}</strong></span>
      <span className="execution-progress">{segments.flatMap(segment=>(["actual","planned"] as const).flatMap(kind=>{
        const value=segment[kind];
        if(value<=0)return [];
        const label=`${segment.name} · ${kind==="actual"?t("已花"):t("待采购")} ${money(value)}`;
        return [<span key={`${segment.name}-${kind}`} className={`execution-segment ${kind}`} style={{width:value/scale*100+"%",backgroundColor:color(segment.name)}} tabIndex={0} role="img" aria-label={label} data-tooltip={label} onClick={event=>event.preventDefault()} onKeyDown={event=>{if(event.key==="Enter"||event.key===" ")event.preventDefault();}}/>];
      }))}</span>
    </>;
    const hasContents=children.length>0||hasDirect||details.length>0;
    return <div className="execution-budget" key={budget.category}>
      {hasContents?<details open><summary className="execution-budget-summary">{content}</summary>
        <div className="execution-budget-content">
          {children.length>0&&<div className="execution-budget-children">{children.map(renderBudget)}</div>}
          {(hasDirect||details.length>0)&&<div className="execution-details"><div className="execution-details-heading">{t("支出明细")}</div>{hasDirect&&<div className="execution-detail-leaf">{detailLine(budget.category,direct!.directActual,direct!.directPlanned)}</div>}{details.map(renderDetail)}</div>}
        </div>
      </details>:<div className="execution-budget-summary">{content}</div>}
    </div>;
  };
  const outside=buildBudgetTree(categories,spending.filter(row=>!owner(row.category))).filter(hasSpending);
  return <section className="panel finance-bars finance-category-spending">
    <div className="panel-head"><div><h2>{t("分类预算执行")}</h2></div></div>
    <div className="budget-execution-tree">
      {budgets.length?budgets.filter(row=>!parent(row.category)).map(renderBudget):<p className="empty">{t("尚未分配分类预算")}</p>}
      {outside.length>0&&<div className="execution-outside"><div className="execution-details-heading">{t("计划外支出")}</div>{outside.map(renderDetail)}</div>}
    </div>
  </section>;
}
