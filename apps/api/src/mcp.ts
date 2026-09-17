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
export function createMcpServer(api: ApiCall) {
  const server = new McpServer({ name: "AL1S-ERP", version: "0.3.0" });
  const register = (tool: string, description: string, inputSchema: z.ZodRawShape, method: "GET" | "POST" | "PATCH" | "DELETE", route: (args: any) => { url: string; body?: Record<string, unknown> }) => {
    server.registerTool(tool, {
      description, inputSchema,
      annotations: { readOnlyHint: method === "GET", destructiveHint: method === "DELETE", openWorldHint: false },
    }, async args => {
      const { url, body } = route(args);
      const result = await api(method, url, body);
      return { isError: result.status >= 400, content: [{ type: "text" as const, text: JSON.stringify(result.body) }] };
    });
  };
  register("list_homes", "List homes and saved family icons.", {}, "GET", () => ({ url: "/api/v1/homes" }));
  const homeFields = { name: name.max(80), icon: z.enum(["house", "building", "trees", "warehouse", "castle", "leaf", "star"]).describe("Built-in family icon") };
  register("create_home", "Create a home with built-in categories and no locations.", homeFields, "POST", body=>({url:"/api/v1/homes",body}));
  register("update_home", "Edit a home name and family icon. Both fields are required.", {homeId,...homeFields}, "PATCH", ({homeId,...body})=>({url:homePath(homeId),body}));
  register("search_items", "Search inventory. Returns {items,total,limit,offset,hasMore,nextOffset}; continue until nextOffset is null. Location/category filters include descendants by default.", {
    homeId, query: name.optional(), category: name.optional(), locationId: locationId.optional(),
    includeDescendantLocations: z.boolean().optional(), includeDescendantCategories: z.boolean().optional(),
    lowStockOnly: z.boolean().optional(), expiryBefore: z.string().date().optional(), ...paging,
  }, "GET", ({homeId,...filters})=>({url:`${homePath(homeId)}/items?${query({...filters,paged:true})}`}));
  register("get_item", "Get an active item and its stock/expiry summary. Use list_batches for individual batches.", {homeId,itemId}, "GET", ({homeId,itemId})=>({url:`${homePath(homeId)}/items/${itemId}`}));
  register("get_stock", "Get stock balance, optionally for one item/location/batch.", {homeId,itemId: itemId.optional(),locationId:locationId.optional(),batchId:z.string().uuid().optional()}, "GET", ({homeId,...filters})=>({url:`${homePath(homeId)}/stock?${query(filters)}`}));
  const itemFields = { name, icon: itemIconSchema.nullable().optional().describe("Explicit built-in icon; null restores automatic display matching"), category:name.optional(), baseUnit:name.max(30), reorderPoint:z.number().nonnegative().optional(),locationId:locationId.optional() };
  register("create_item", "Create an item. initialQuantity defaults to 0 and requires locationId when positive. Dates describe the opening batch, not all future receipts.", {homeId,...itemFields,initialQuantity:z.number().nonnegative().optional(),...dates}, "POST", ({homeId,initialQuantity=0,...body})=>({url:`${homePath(homeId)}/items`,body:{category:"其他",reorderPoint:0,reorderQuantity:0,...body,initialStock:initialQuantity}}));
  register("update_item", "Edit item master data. Changing location moves existing stock there while preserving batches. Use update_batch for dates. Unit conversion is not supported.", {
    homeId,itemId,name:name.optional(),icon:itemFields.icon,category:name.optional(),baseUnit:name.max(30).optional(),reorderPoint:z.number().nonnegative().optional(),locationId:locationId.nullable().optional(),
  }, "PATCH", ({homeId,itemId,...body})=>({url:`${homePath(homeId)}/items/${itemId}`,body}));
  for(const [kind,resource] of [["location","locations"],["category","categories"]] as const) {
    register(`list_${resource}`, "List active tree nodes with parentId.", {homeId}, "GET", ({homeId})=>({url:`${homePath(homeId)}/${resource}`}));
    register(`create_${kind}`, "Create a tree node. Omit parentId for a root.", {homeId,name,parentId:z.string().uuid().optional()}, "POST", ({homeId,...body})=>({url:`${homePath(homeId)}/${resource}`,body}));
    register(`update_${kind}`, "Edit node name and parent. parentId is required; null makes it a root.", {homeId,[`${kind}Id`]:z.string().uuid(),name,parentId:z.string().uuid().nullable()}, "PATCH", args=>({url:`${homePath(args.homeId)}/${resource}/${args[`${kind}Id`]}`,body:{name:args.name,parentId:args.parentId}}));
  }
  for(const [kind,resource] of [["item","items"],["category","categories"],["location","locations"]] as const) {
    register(`delete_${kind}`, kind==="item" ? "Delete an item and remaining stock; retain history and unlink purchases." : "Delete a node; promote its children and direct items. Root items use a fallback. Only item changes are logged.", {homeId,[`${kind}Id`]:z.string().uuid()}, "DELETE", args=>({url:`${homePath(args.homeId)}/${resource}/${args[`${kind}Id`]}`}));
  }
  register("list_transactions", "Page through item-only history; no node or home events. Returns {items,total,hasMore,nextOffset,snapshotAt}. Reuse snapshotAt and nextOffset for consistent pagination.", {
    homeId,itemId:itemId.optional(),locationId:locationId.optional(),batchId:z.string().uuid().optional(),query:name.optional(),
    type:z.enum(["receipt","issue","delete","reclassify","move","update"]).optional(),
    occurredFrom:z.string().datetime().optional(),occurredTo:z.string().datetime().optional(),snapshotAt:z.string().datetime().optional(),...paging,
  }, "GET", ({homeId,...filters})=>({url:`${homePath(homeId)}/transactions?${query(filters)}`}));
  register("list_shopping_items", "List automatic low-stock recommendations and pending manual purchases.", {homeId}, "GET", ({homeId})=>({url:`${homePath(homeId)}/shopping-list`}));
  const shoppingFields = {itemId:itemId.nullable().optional(),name:name.optional(),quantity:quantity.optional(),unit:name.max(30).optional(),category:name.optional(),locationId:locationId.optional()};
  register("create_shopping_item", "Create a purchase, quantity defaults to 1. Linked items inherit their fields; standalone purchases require name, unit, category and locationId.", {homeId,...shoppingFields}, "POST", ({homeId,...body})=>({url:`${homePath(homeId)}/shopping-list`,body}));
  register("update_shopping_item", "Edit a pending manual purchase. itemId:null unlinks it; supply standalone fields when unlinking. Automatic recommendations follow their item.", {homeId,shoppingItemId:z.string().uuid(),...shoppingFields}, "PATCH", ({homeId,shoppingItemId,...body})=>({url:`${homePath(homeId)}/shopping-list/${shoppingItemId}`,body}));
  register("receive_shopping_item", "Receive actualQuantity as a new batch. Standalone purchases create an item. Automatic IDs use auto:<item UUID>. Safe retries require the same idempotencyKey.", {homeId,shoppingItemId:z.string().min(1),actualQuantity:quantity,idempotencyKey,locationId:locationId.optional(),...dates}, "POST", ({homeId,shoppingItemId,...body})=>({url:`${homePath(homeId)}/shopping-list/${encodeURIComponent(shoppingItemId)}/receive`,body}));
  register("delete_shopping_item", "Remove a manual purchase without changing stock. Automatic recommendations follow minimum stock and cannot be deleted directly.", {homeId,shoppingItemId:z.string().uuid()}, "DELETE", ({homeId,shoppingItemId})=>({url:`${homePath(homeId)}/shopping-list/${shoppingItemId}`}));
  for(const type of ["receipt","issue"] as const) {
    register(`record_${type}`, type==="receipt" ? "Receive stock as a new batch with optional production and expiry dates." : "Consume a specified batch, or earliest-expiring batches first (undated last). Rejects insufficient stock.", {
      homeId,itemId,locationId,quantity,idempotencyKey,reason:z.string().max(200).optional(),...(type==="receipt" ? dates : {batchId:z.string().uuid().optional()}),
    }, "POST", ({homeId,...body})=>({url:`${homePath(homeId)}/stock/${type}`,body}));
  }
  register("transfer_stock", "Transfer stock between locations without changing total stock or batch identity. Omit batchId to allocate earliest expiry first.", {homeId,itemId,sourceLocationId:locationId,targetLocationId:locationId,quantity,idempotencyKey,batchId:z.string().uuid().optional(),reason:z.string().max(200).optional()}, "POST", ({homeId,...body})=>({url:`${homePath(homeId)}/stock/transfers`,body}));
  register("list_batches", "List batch balances per location. Dates are optional; legacy batches represent migrated stock. Paginated result; includeEmpty defaults to false.", {homeId,itemId:itemId.optional(),locationId:locationId.optional(),includeEmpty:z.boolean().optional(),...paging}, "GET", ({homeId,...filters})=>({url:`${homePath(homeId)}/batches?${query(filters)}`}));
  register("update_batch", "Correct a batch label or dates; affects that batch only and records an item change. Null clears a label or date.", {homeId,batchId:z.string().uuid(),label:name.max(100).nullable().optional(),...dates}, "PATCH", ({homeId,batchId,...body})=>({url:`${homePath(homeId)}/batches/${batchId}`,body}));
  return server;
}

export async function handleMcpRequest(request: FastifyRequest, reply: FastifyReply, api: ApiCall) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(api);
  await server.connect(transport);
  reply.hijack();
  reply.raw.on("close", () => { void server.close(); });
  await transport.handleRequest(request.raw, reply.raw, request.body);
}
