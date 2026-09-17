import { buildApp } from "./app.js";

const app = await buildApp();
await app.listen({ host: process.env.BIND_ADDRESS ?? "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
