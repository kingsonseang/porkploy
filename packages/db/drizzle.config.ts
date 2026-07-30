import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url: Bun.env.DATABASE_URL ?? "",
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./src/schema/index.ts",
});
