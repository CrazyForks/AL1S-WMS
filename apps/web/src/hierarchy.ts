export type HierarchyNode = { id:string; name:string; parentId:string|null };

export function flattenHierarchy<T extends HierarchyNode>(nodes:T[],parentId:string|null=null,depth=0):(T&{depth:number})[] {
  return nodes.filter(node=>node.parentId===parentId).flatMap(node=>[
    {...node,depth},
    ...flattenHierarchy(nodes,node.id,depth+1),
  ]);
}

export function summarizeHierarchy<T extends HierarchyNode, I>(nodes:T[],items:I[],matches:(item:I,node:T)=>boolean) {
  return flattenHierarchy(nodes).map(node=>{
    const branchIds=new Set([node.id]);
    let changed=true;
    while(changed){
      changed=false;
      for(const candidate of nodes) if(candidate.parentId&&branchIds.has(candidate.parentId)&&!branchIds.has(candidate.id)){
        branchIds.add(candidate.id);
        changed=true;
      }
    }
    const branchNodes=nodes.filter(candidate=>branchIds.has(candidate.id));
    return {...node,count:items.filter(item=>branchNodes.some(candidate=>matches(item,candidate))).length};
  }).filter(node=>node.count>0);
}
