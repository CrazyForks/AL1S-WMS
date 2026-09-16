import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { createItemSchema, type Item } from "@family-erp/contracts";

const app = Fastify({ logger: true });
const items = new Map<string, Item>();

app.get("/healthz", async () => ({ status: "ok" }));

app.get<{ Params: { homeId: string } }>("/api/v1/homes/:homeId/items", async (request) => {
  return [...items.values()].filter((item) => item.homeId === request.params.homeId);
});

app.post<{ Params: { homeId: string }; Body: unknown }>("/api/v1/homes/:homeId/items", async (request, reply) => {
  const parsed = createItemSchema.safeParse({ ...request.body, homeId: request.params.homeId });
  if (!parsed.success) return reply.code(400).send({ code: "VALIDATION_ERROR", details: parsed.error.flatten() });

  const item: Item = { ...parsed.data, id: randomUUID(), active: true };
  items.set(item.id, item);
  return reply.code(201).send(item);
});

app.register(async (mcp) => {
  mcp.post("/mcp", async () => ({
    jsonrpc: "2.0",
    error: { code: -32601, message: "MCP transport is reserved for the Streamable HTTP adapter" },
    id: null
  }));
});

const port = Number(process.env.PORT ?? 8080);
app.listen({ host: process.env.BIND_ADDRESS ?? "127.0.0.1", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
