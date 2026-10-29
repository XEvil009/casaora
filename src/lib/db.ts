import "server-only";

import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";

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
 * Execute a parameterized query against PostgreSQL.
 *
 * Only server-side callers should use this function.
 * Values are supplied separately from SQL text.
 */
export async function queryDatabase<
  T extends QueryResultRow = QueryResultRow,
>(
  text: string,
  values: Array<string | number> = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values);
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
