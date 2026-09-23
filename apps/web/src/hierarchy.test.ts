import assert from "node:assert/strict";
import {test} from "node:test";
import {flattenHierarchy,summarizeHierarchy} from "./hierarchy.js";

const nodes=[
  {id:"root",name:"Root",parentId:null},
  {id:"child",name:"Child",parentId:"root"},
  {id:"leaf",name:"Leaf",parentId:"child"},
  {id:"empty",name:"Empty",parentId:null},
];

test("flattenHierarchy keeps parent-first order and depth",()=>{
  assert.deepEqual(flattenHierarchy(nodes).map(node=>[node.id,node.depth]),[["root",0],["child",1],["leaf",2],["empty",0]]);
});

test("summarizeHierarchy counts matching items across descendants",()=>{
  const items=[{category:"leaf"},{category:"child"},{category:"other"}];
  const summary=summarizeHierarchy(nodes,items,(item,node)=>item.category===node.id);
  assert.deepEqual(summary.map(node=>[node.id,node.count]),[["root",2],["child",2],["leaf",1]]);
});
