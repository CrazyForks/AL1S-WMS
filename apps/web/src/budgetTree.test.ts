import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBudgetTree, categoryPath } from "./budgetTree.js";

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
