import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { itemIconSchema } from "@family-erp/contracts";
import { z } from "zod";

export type ApiCall = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: Record<string, unknown>) => Promise<{ status: number; body: unknown }>;
const homeId = z.string().uuid().describe("Home ID from list_homes");
const itemId = z.string().uuid().describe("Item ID from search_items");
const locationId = z.string().uuid().describe("Location ID from list_locations");
const name = z.string().trim().min(1).max(200);
const quantity = z.number().positive().finite();
const idempotencyKey = z.string().trim().min(1).max(200).describe("Unique key for this operation. Reuse the same key and payload only when retrying.");
const dates = { manufacturedDate: z.string().date().nullable().optional(), expiryDate: z.string().date().nullable().optional() };
const paging = { limit: z.number().int().min(1).max(100).optional().describe("Page size, default 50"), offset: z.number().int().nonnegative().optional().describe("Zero-based offset; use nextOffset from previous result") };
const query = (args: Record<string, unknown>) => new URLSearchParams(Object.entries(args).filter(([, v]) => v !== undefined && v !== null).map(([k,v])=>[k,String(v)])).toString();
const homePath = (id: string) => `/api/v1/homes/${id}`;

// MCP is an authenticated adapter over the same application routes as Web.
export function createMcpServer(api: ApiCall, boundHomeId: string | null = null) {
  const server = new McpServer({ name: "AL1S-ERP", version: "0.4.0" });
  const homeInput: z.ZodRawShape = boundHomeId ? {} : {homeId};
  const scoped = (shape: z.ZodRawShape = {}) => ({...homeInput,...shape});
  const context = (args: Record<string,unknown>) => {
    const {homeId:requestedHomeId,...body}=args;
    return {homeId:boundHomeId??String(requestedHomeId),body};
  };
  const atHome = (args: Record<string,unknown>, suffix: string) => {
    const value=context(args);
    return {url:`${homePath(value.homeId)}${suffix}`,body:value.body};
  };
  const register = (tool: string, description: string, inputSchema: z.ZodRawShape, method: "GET" | "POST" | "PATCH" | "DELETE", route: (args: any) => { url: string; body?: Record<string, unknown> }) => {
    server.registerTool(tool, {
      description, inputSchema,
      annotations: { readOnlyHint: method === "GET", destructiveHint: method === "DELETE", openWorldHint: false },
    }, async args => {
      const { url, body } = route(args);
      const result = body && Object.keys(body).length ? await api(method, url, body) : await api(method, url);
      return { isError: result.status >= 400, content: [{ type: "text" as const, text: JSON.stringify(result.body) }] };
    });
  };
  const text = (value:unknown) => ({content:[{type:"text" as const,text:JSON.stringify(value)}]});
  server.registerTool("get_home_context", {
    description:"Start here. Returns the home or homes this token may manage and whether homeId is required by other tools.",
    inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  }, async()=>{
    const result=await api("GET","/api/v1/homes");
    const homes=Array.isArray(result.body)?result.body:[];
    return text({scope:boundHomeId?"home":"account",homeIdRequired:!boundHomeId,currentHome:boundHomeId?homes[0]??null:null,homes,recommendedNextTool:"get_home_overview"});
  });
  server.registerTool("get_agent_guide", {
    description:"Read the canonical workflows for overview, batch receipt, shopping receipt, and physical stock reconciliation.",
    inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  }, async()=>text({
    rules:[
      "Call get_home_context first. Account-scoped tokens must pass homeId; home-scoped tokens never do.",
      "Call get_home_overview before proactive household management.",
      "Every retryable write needs a unique idempotencyKey. Reuse the same key only to retry the exact same payload.",
      "Quantities always use the item's baseUnit. Unit conversion is not supported.",
    ],
    receipt:["search_items to resolve itemId","list_locations to resolve locationId","record_receipt once; every receipt creates a new batch and dates belong only to that batch","report beforeQuantity, afterQuantity, and created batch"],
    shoppingReceipt:["list_shopping_items","receive_shopping_item with actualQuantity, locationId when needed, and optional batch dates","do not update or delete the item first"],
    expiredHandling:["get_home_overview returns the exact expired batchId and remaining quantity","confirm disposal or consumption with the user","record_issue with that batchId, quantity, and a clear reason"],
    stocktake:["search_items and list_locations","reconcile_stock with countedQuantity for one item at one location","positive differences create a new batch; negative differences consume FEFO unless batchId is supplied","report difference and affected batches"],
  }));
  register("list_homes", boundHomeId?"Return the single home bound to this token.":"List homes available to this account token; choose one homeId before other calls.", {}, "GET", () => ({ url: "/api/v1/homes" }));
  const homeFields = { name: name.max(80), icon: z.enum(["house", "building", "trees", "warehouse", "castle", "leaf", "star"]).describe("Built-in family icon") };
  if(!boundHomeId)register("create_home", "Create a home with built-in categories and no locations. Available only to account-scoped tokens.", homeFields, "POST", body=>({url:"/api/v1/homes",body}));
  register("update_home", "Edit the selected home name and icon. Both fields are required.", scoped(homeFields), "PATCH", args=>{const value=context(args);return {url:homePath(value.homeId),body:value.body};});
  register("get_home_overview", "Primary proactive-management call. Summarizes low stock, expiring batches, expired batches, pending purchases, and recommended actions.", scoped({
    expiryDays:z.number().int().min(1).max(365).optional().describe("Upcoming expiry window; default 30 days"),limit:z.number().int().min(1).max(50).optional().describe("Maximum rows per section; default 10"),
  }), "GET", args=>{const value=context(args);return {url:`${homePath(value.homeId)}/overview?${query(value.body)}`};});
  register("search_items", "Search inventory for stocktake or maintenance. Returns a page object; location and category filters include descendants by default.", scoped({
    query: name.optional(), category: name.optional(), locationId: locationId.optional(),
    includeDescendantLocations: z.boolean().optional(), includeDescendantCategories: z.boolean().optional(),
    lowStockOnly: z.boolean().optional(), expiryBefore: z.string().date().optional(), ...paging,
  }), "GET", args=>{const value=context(args);return {url:`${homePath(value.homeId)}/items?${query({...value.body,paged:true})}`};});
  register("get_item", "Get one active item and its stock/nearest-expiry summary. Use list_batches for batch detail.", scoped({itemId}), "GET", args=>{const value=context(args);return {url:`${homePath(value.homeId)}/items/${value.body.itemId}`};});
  register("get_stock", "Get balances per location, optionally filtered by item, location, or batch.", scoped({itemId:itemId.optional(),locationId:locationId.optional(),batchId:z.string().uuid().optional()}), "GET", args=>{const value=context(args);return {url:`${homePath(value.homeId)}/stock?${query(value.body)}`};});
  const itemFields = { name, icon: itemIconSchema.nullable().optional().describe("Explicit built-in icon; null restores automatic display matching"), category:name.optional(), baseUnit:name.max(30), reorderPoint:z.number().nonnegative().optional(),locationId:locationId.optional() };
  register("create_item", "Create an item. initialQuantity requires locationId; optional dates describe only its opening batch.", scoped({...itemFields,initialQuantity:z.number().nonnegative().optional(),...dates}), "POST", args=>{const value=context(args);const {initialQuantity=0,...body}=value.body;return {url:`${homePath(value.homeId)}/items`,body:{category:"其他",reorderPoint:0,reorderQuantity:0,...body,initialStock:initialQuantity}};});
  register("update_item", "Edit item master data. Changing location moves existing stock there while preserving batches. Use update_batch for dates. Unit conversion is not supported.", {
    ...homeInput,itemId,name:name.optional(),icon:itemFields.icon,category:name.optional(),baseUnit:name.max(30).optional(),reorderPoint:z.number().nonnegative().optional(),locationId:locationId.nullable().optional(),
  }, "PATCH", args=>{const value=context(args);const {itemId,...body}=value.body;return {url:`${homePath(value.homeId)}/items/${itemId}`,body};});
  for(const [kind,resource] of [["location","locations"],["category","categories"]] as const) {
    register(`list_${resource}`, `List active ${kind} tree nodes with id, name, and parentId. Resolve IDs before inventory writes.`, scoped(), "GET", args=>atHome(args,`/${resource}`));
    register(`create_${kind}`, `Add a ${kind} node. Omit parentId for a root.`, scoped({name,parentId:z.string().uuid().optional()}), "POST", args=>atHome(args,`/${resource}`));
    register(`update_${kind}`, "Rename or move a node. parentId is required; null makes it a root.", scoped({[`${kind}Id`]:z.string().uuid(),name,parentId:z.string().uuid().nullable()}), "PATCH", args=>{const value=context(args);const nodeId=value.body[`${kind}Id`];return {url:`${homePath(value.homeId)}/${resource}/${nodeId}`,body:{name:value.body.name,parentId:value.body.parentId}};});
  }
  for(const [kind,resource] of [["item","items"],["category","categories"],["location","locations"]] as const) {
    register(`delete_${kind}`, kind==="item" ? "Destructive: delete an item and remaining stock after user confirmation; history is retained." : "Destructive: delete a node after user confirmation; children and direct items are promoted.", scoped({[`${kind}Id`]:z.string().uuid()}), "DELETE", args=>{const value=context(args);return {url:`${homePath(value.homeId)}/${resource}/${value.body[`${kind}Id`]}`};});
  }
  register("list_transactions", "Page through item-only history; no node or home events. Returns {items,total,hasMore,nextOffset,snapshotAt}. Reuse snapshotAt and nextOffset for consistent pagination.", {
    ...homeInput,itemId:itemId.optional(),locationId:locationId.optional(),batchId:z.string().uuid().optional(),query:name.optional(),
    type:z.enum(["receipt","issue","delete","reclassify","move","update"]).optional(),
    occurredFrom:z.string().datetime().optional(),occurredTo:z.string().datetime().optional(),snapshotAt:z.string().datetime().optional(),...paging,
  }, "GET", args=>{const value=context(args);return {url:`${homePath(value.homeId)}/transactions?${query(value.body)}`};});
  register("list_shopping_items", "List manual purchases and automatic low-stock recommendations. completed=0 means pending.", scoped(), "GET", args=>atHome(args,"/shopping-list"));
  const shoppingFields = {itemId:itemId.nullable().optional(),name:name.optional(),quantity:quantity.optional(),unit:name.max(30).optional(),category:name.optional(),locationId:locationId.optional()};
  register("create_shopping_item", "Create a purchase. Link itemId when buying known inventory; standalone purchases require name, unit, category, and locationId.", scoped(shoppingFields), "POST", args=>atHome(args,"/shopping-list"));
  register("update_shopping_item", "Edit a pending manual purchase. itemId:null unlinks it. Automatic recommendations cannot be edited.", scoped({shoppingItemId:z.string().uuid(),...shoppingFields}), "PATCH", args=>{const value=context(args);const {shoppingItemId,...body}=value.body;return {url:`${homePath(value.homeId)}/shopping-list/${shoppingItemId}`,body};});
  register("receive_shopping_item", "Complete a purchase by receiving actualQuantity as one new batch. Include production/expiry dates when known. Safe retries require the same key and payload.", scoped({shoppingItemId:z.string().min(1),actualQuantity:quantity,idempotencyKey,locationId:locationId.optional(),...dates}), "POST", args=>{const value=context(args);const {shoppingItemId,...body}=value.body;return {url:`${homePath(value.homeId)}/shopping-list/${encodeURIComponent(String(shoppingItemId))}/receive`,body};});
  register("delete_shopping_item", "Delete a pending manual purchase without changing stock. Automatic recommendations cannot be deleted.", scoped({shoppingItemId:z.string().uuid()}), "DELETE", args=>{const value=context(args);return {url:`${homePath(value.homeId)}/shopping-list/${value.body.shoppingItemId}`};});
  for(const type of ["receipt","issue"] as const) {
    register(`record_${type}`, type==="receipt" ? "Receive stock as a new batch with optional production and expiry dates." : "Consume a specified batch, or earliest-expiring batches first (undated last). Rejects insufficient stock.", {
      ...homeInput,itemId,locationId,quantity,idempotencyKey,reason:z.string().max(200).optional(),...(type==="receipt" ? dates : {batchId:z.string().uuid().optional()}),
    }, "POST", args=>atHome(args,`/stock/${type}`));
  }
  register("reconcile_stock", "Physical stocktake: set the counted quantity for one item at one location. Positive differences create a dated batch; negative differences consume FEFO or batchId.", scoped({itemId,locationId,countedQuantity:z.number().nonnegative().finite(),idempotencyKey,reason:z.string().max(200).optional(),batchId:z.string().uuid().optional(),...dates}), "POST", args=>atHome(args,"/stock/reconcile"));
  register("transfer_stock", "Transfer stock between locations without changing total stock or batch identity. Omit batchId for FEFO.", scoped({itemId,sourceLocationId:locationId,targetLocationId:locationId,quantity,idempotencyKey,batchId:z.string().uuid().optional(),reason:z.string().max(200).optional()}), "POST", args=>atHome(args,"/stock/transfers"));
  register("list_batches", "List batch balances per location, ordered by expiry. includeEmpty also returns consumed batches.", scoped({itemId:itemId.optional(),locationId:locationId.optional(),includeEmpty:z.boolean().optional(),...paging}), "GET", args=>{const value=context(args);return {url:`${homePath(value.homeId)}/batches?${query(value.body)}`};});
  register("update_batch", "Correct one batch label or dates. Null clears a value; this never changes other batches.", scoped({batchId:z.string().uuid(),label:name.max(100).nullable().optional(),...dates}), "PATCH", args=>{const value=context(args);const {batchId,...body}=value.body;return {url:`${homePath(value.homeId)}/batches/${batchId}`,body};});
  return server;
}

export async function handleMcpRequest(request: FastifyRequest, reply: FastifyReply, api: ApiCall, boundHomeId: string | null = null) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(api,boundHomeId);
  await server.connect(transport);
  reply.hijack();
  reply.raw.on("close", () => { void server.close(); });
  await transport.handleRequest(request.raw, reply.raw, request.body);
}
