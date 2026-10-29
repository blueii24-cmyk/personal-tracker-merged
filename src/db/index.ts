import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type DrizzleDb = ReturnType<typeof drizzle>;
type RuntimeGlobal = typeof globalThis & {
  __personalTrackerPool?: Pool;
  __personalTrackerDb?: DrizzleDb;
};

/**
 * Lazy database initialization allows the app to build and run in demo mode
 * without DATABASE_URL. Database access fails only when a backend route is used.
 */
function getDatabase(): DrizzleDb {
  const runtime = globalThis as RuntimeGlobal;
  if (runtime.__personalTrackerDb) return runtime.__personalTrackerDb;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to enable database mode.");

  const pool = runtime.__personalTrackerPool ?? new Pool({ connectionString: databaseUrl });
  runtime.__personalTrackerPool = pool;
  const instance = drizzle(pool);
  runtime.__personalTrackerDb = instance;
  return instance;
}

// Proxy retains Drizzle's normal method surface without connecting during import/build.
export const db = new Proxy({} as DrizzleDb, {
  get(_target, property) {
    const instance = getDatabase() as unknown as Record<PropertyKey, unknown>;
    const value = instance[property];
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
