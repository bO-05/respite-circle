import { defineConfig } from "drizzle-kit";
import { loadEnvLocal } from "./src/db/env";

// drizzle-kit runs outside Next, so load the git-excluded local env first.
loadEnvLocal();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
  strict: true,
  verbose: true,
});
