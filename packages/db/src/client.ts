import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
// biome-ignore lint/performance/noNamespaceImport: allow namespace import
import * as schema from "./schema";

if (!Bun.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(Bun.env.DATABASE_URL, {
  connect_timeout: 10,
  idle_timeout: 20,
  max: 10,
});

export const db = drizzle(client, { schema });

export type Db = typeof db;
