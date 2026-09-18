import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBudgetTree, budgetAllocations, budgetSegmentColor, categoryPath, setBudgetAllocation, removeBudgetAllocation } from "./budgetTree.js";

test("category colors support 100 distinct positions and restart consistently for each group",()=>{
  const first=Array.from({length:100},(_,index)=>budgetSegmentColor(index));
  assert.equal(new Set(first).size,100);
  for(const color of first){
    const [hue,saturation,lightness]=color.match(/[\d.]+/g)!.map(Number);
    assert.ok(hue>=188&&hue<=226);
    assert.ok(saturation>=36&&saturation<=52);
    assert.ok(lightness>=38&&lightness<=60);
  }
  assert.equal(budgetSegmentColor(Number.NaN),first[0]);
  assert.deepEqual(Array.from({length:100},(_,index)=>budgetSegmentColor(index)),first);
  assert.deepEqual(Array.from({length:2},(_,index)=>budgetSegmentColor(index)),first.slice(0,2));
  assert.equal(budgetSegmentColor(100),budgetSegmentColor(100));
  assert.notEqual(budgetSegmentColor(100),first[0]);
});

test("tree totals preserve direct costs without double counting descendants",()=>{
  const categories=[
    {id:"food",parentId:null,name:"食品"},
    {id:"drink",parentId:"food",name:"饮品"},
    {id:"tea",parentId:"drink",name:"茶饮"},
  ];
  const rows=[
    {category:"食品",actual:20,planned:0},
    {category:"饮品",actual:120,planned:10},
    {category:"茶饮",actual:100,planned:90},
    {category:"旧分类",actual:15,planned:0},
  ];
  const tree=buildBudgetTree(categories,rows);
  assert.deepEqual(categoryPath("茶饮",categories),["食品","饮品","茶饮"]);
  assert.equal(tree[0].actual,240);
  assert.equal(tree[0].planned,100);
  assert.equal(tree[0].directActual,20);
  assert.equal(tree[0].children[0].actual,220);
  assert.equal(tree[0].children[0].directActual,120);
  assert.equal(tree[0].children[0].children[0].actual,100);
  assert.equal(tree[1].name,"旧分类");
  assert.equal(tree[1].actual,15);
  assert.deepEqual(buildBudgetTree(categories,[])[0].children[0].children[0].path,["食品","饮品","茶饮"]);
});

test("adding children grows parent totals while preserving direct allocations",()=>{
  const categories=[{id:"food",parentId:null,name:"食品"},{id:"drink",parentId:"food",name:"饮品"},{id:"instant",parentId:"food",name:"即食食品"},{id:"tea",parentId:"drink",name:"茶饮"}];
  let entries=setBudgetAllocation(categories,[],"饮品","30.00");
  const row=(name:string)=>budgetAllocations(categories,entries).rows.find(row=>row.category===name)!;
  assert.equal(row("食品").amount,30);
  assert.equal(row("食品").unallocated,0);
  entries=setBudgetAllocation(categories,entries,"食品","100.00");
  assert.equal(row("食品").unallocated,70);
  entries=setBudgetAllocation(categories,entries,"即食食品","100.00");
  assert.equal(row("食品").amount,200);
  assert.equal(row("食品").unallocated,70);
  assert.equal(budgetAllocations(categories,entries).total,200);
  entries=setBudgetAllocation(categories,entries,"茶饮","0.78");
  assert.equal(row("饮品").amount,30.78);
  assert.equal(row("食品").amount,200.78);
  assert.equal(row("食品").unallocated,70);
  entries=removeBudgetAllocation(categories,entries,"饮品");
  assert.equal(row("食品").amount,170);
  assert.equal(row("食品").unallocated,70);
  assert.equal(row("茶饮"),undefined);
});

test("allocation hierarchy is independent of add order and counts only root limits",()=>{
  const categories=[{id:"food",parentId:null,name:"食品"},{id:"drink",parentId:"food",name:"饮品"},{id:"tea",parentId:"drink",name:"茶饮"}];
  const food={category:"食品",amount:300},drink={category:"饮品",amount:100},tea={category:"茶饮",amount:40};
  for(const entries of [[food,drink,tea],[tea,drink,food]]) {
    const result=budgetAllocations(categories,entries);
    assert.equal(result.total,300);
    assert.equal(result.rows.find(row=>row.category==="食品")?.unallocated,200);
    assert.equal(result.rows.find(row=>row.category==="饮品")?.unallocated,60);
    assert.equal(result.rows.find(row=>row.category==="茶饮")?.parent,"饮品");
  }
  assert.equal(budgetAllocations(categories,[food,tea]).rows.find(row=>row.category==="食品")?.unallocated,260);
  assert.equal(budgetAllocations(categories,[drink,tea]).total,100);
  assert.equal(budgetAllocations(categories,[{...food,amount:50},drink]).rows.find(row=>row.category==="食品")?.unallocated,-50);
});
