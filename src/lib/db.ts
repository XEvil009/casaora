import "server-only";

import { Pool } from "pg";

let pool: Pool | undefined;

/**
 * Lazily create the PostgreSQL connection pool.
 * The connection string is read only on the server.
 */
function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (
    !connectionString.startsWith("postgresql://") &&
    !connectionString.startsWith("postgres://")
  ) {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }

  pool ??= new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 30000,
    allowExitOnIdle: true,
  });

  return pool;
}

/**
 * Return a safe readiness result without exposing connection details.
 */
export async function checkDatabase(): Promise<boolean> {
  try {
    const result = await getPool().query("SELECT 1 AS connected");
    return result.rows[0]?.connected === 1;
  } catch {
    return false;
  }
}
