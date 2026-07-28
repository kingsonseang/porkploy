import { cors } from "@elysiajs/cors";
import { appRouter } from "@porkploy/trpc";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Elysia } from "elysia";
import { betterAuth } from "./lib/auth";
import { createContext } from "./lib/context";
import { webhookHandler } from "./routers/webhooks";

const PORT = Number(process.env.PORT ?? 3001);

export const app = new Elysia()
  .use(
    cors({
      credentials: true,
      origin: process.env.DASHBOARD_URL ?? "http://localhost:3000",
    })
  )
  .use(betterAuth)
  .all("/trpc/*", async ({ request }) =>
    fetchRequestHandler({
      createContext,
      endpoint: "/trpc",
      req: request,
      router: appRouter,
    })
  )
  .post("/webhooks/github", webhookHandler)
  .get("/health", () => ({ ok: true, ts: Date.now() }))
  .listen(PORT);

console.log(`Control plane running on http://localhost:${PORT}`);
