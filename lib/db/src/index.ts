import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;
const connectionString = process.env.EXTERNAL_DATABASE_URL?.trim() || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "EXTERNAL_DATABASE_URL or DATABASE_URL must be set. Did you forget to configure a database?",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
