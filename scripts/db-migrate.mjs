import { combineCleanupError, rollbackAndRethrow, runCleanupActions } from "./lib/db-migration-errors.mjs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  checksum,
  sortMigrations,
  stripTransactionWrapper,
} from "./lib/db-migrations.mjs";

const { Client } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");
const LOCK_KEY = "casaora:schema-migrations:v1";

if (!process.env.DATABASE_URL && existsSync(path.join(ROOT, ".env.local"))) {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

let parsedUrl;

try {
  parsedUrl = new URL(connectionString);
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}

if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
  console.error("DATABASE_URL must use PostgreSQL.");
  process.exit(1);
}

function readMigrations() {
  return sortMigrations(readdirSync(MIGRATIONS_DIR))
    .map((name) => {
      const file = path.join(MIGRATIONS_DIR, name);
      const sql = readFileSync(file, "utf8");

      return {
        name,
        sql,
        executableSql: stripTransactionWrapper(sql),
        checksum: checksum(sql),
      };
    });
}

function connectionForDatabase(database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

async function connect(database) {
  const client = new Client({
    connectionString: connectionForDatabase(database),
    connectionTimeoutMillis: 5000,
    application_name: "casaora-db-migrations",
  });

  await client.connect();
  return client;
}

async function acquireLock(client) {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK_KEY]);
}

async function releaseLock(client) {
  await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
}

async function ledgerExists(client) {
  const result = await client.query(
    "SELECT to_regclass('public.schema_migrations') AS ledger",
  );
  return result.rows[0].ledger !== null;
}

async function assertEmptySchema(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public') AS relations,

      (SELECT count(*)
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public'
         AND t.typtype IN ('e', 'd', 'c', 'r', 'm')) AS types,

      (SELECT count(*)
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public') AS routines,

      (SELECT count(*)
       FROM pg_operator o
       JOIN pg_namespace n ON n.oid = o.oprnamespace
       WHERE n.nspname = 'public') AS operators,

      (SELECT count(*)
       FROM pg_opclass o
       JOIN pg_namespace n ON n.oid = o.opcnamespace
       WHERE n.nspname = 'public') AS operator_classes,

      (SELECT count(*)
       FROM pg_opfamily o
       JOIN pg_namespace n ON n.oid = o.opfnamespace
       WHERE n.nspname = 'public') AS operator_families,

      (SELECT count(*)
       FROM pg_collation c
       JOIN pg_namespace n ON n.oid = c.collnamespace
       WHERE n.nspname = 'public') AS collations,

      (SELECT count(*)
       FROM pg_conversion c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public') AS conversions,

      (SELECT count(*)
       FROM pg_ts_config c
       JOIN pg_namespace n ON n.oid = c.cfgnamespace
       WHERE n.nspname = 'public') AS text_search_configs,

      (SELECT count(*)
       FROM pg_ts_dict d
       JOIN pg_namespace n ON n.oid = d.dictnamespace
       WHERE n.nspname = 'public') AS text_search_dictionaries
  `);

  const counts = Object.values(result.rows[0]).map(Number);
  const hasObjects = counts.some((count) => count > 0);

  if (hasObjects) {
    throw new Error(
      "The public schema already contains objects but has no migration ledger. " +
      "Refusing to run migrations. Reconcile the schema before proceeding.",
    );
  }
}

async function readAppliedMigrations(client) {
  if (!(await ledgerExists(client))) return [];

  const result = await client.query(`
    SELECT migration_id, checksum
    FROM public.schema_migrations
    ORDER BY migration_id
  `);

  return result.rows;
}

async function runSchemaDump(database, outputPath) {
  const url = new URL(connectionString);
  const env = { ...process.env };

  env.PGHOST = url.hostname;
  env.PGPORT = url.port || "5432";
  env.PGUSER = decodeURIComponent(url.username);
  env.PGDATABASE = database;

  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  if (url.searchParams.has("sslmode")) {
    env.PGSSLMODE = url.searchParams.get("sslmode");
  }

  const args = [
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    "--schema=public",
    "--exclude-table=public.schema_migrations",
    "--file", outputPath,
  ];

  const result = spawnSync("pg_dump", args, {
    encoding: "utf8",
    env: { ...env, PGDATABASE: database },
    timeout: 120000,
  });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(`pg_dump failed: ${result.stderr || "unknown error"}`);
  }
}

function normalizedDump(file) {
  return readFileSync(file, "utf8")
    .replace(/^\\restrict .*\r?\n/gm, "")
    .replace(/^\\unrestrict .*\r?\n/gm, "");
}

async function verifyInitialSchema(client, migrations) {
  if (migrations.length !== 1 || migrations[0].name !== "0001_initial_schema.sql") {
    throw new Error(
      "Initial adoption currently requires exactly 0001_initial_schema.sql. " +
      "Extend the verifier before adding more migrations.",
    );
  }

  const tempName =
    `casaora_verify_${process.pid}_${randomBytes(4).toString("hex")}`;

  if (!/^[a-z0-9_]+$/.test(tempName)) {
    throw new Error("Unsafe temporary database name");
  }

  const admin = await connect("postgres");
  let created = false;
  let tempClient;

  const tempDir = path.join(
    process.env.TMPDIR || "/tmp",
    `casaora-verify-${process.pid}-${randomBytes(4).toString("hex")}`,
  );

  const fs = await import("node:fs/promises");
  let verificationError;

  try {
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [tempName],
    );

    if (existing.rowCount) {
      throw new Error("Temporary verification database name already exists");
    }

    await admin.query(`CREATE DATABASE "${tempName}" TEMPLATE template0`);
    created = true;

    tempClient = await connect(tempName);
    await tempClient.query("BEGIN");

    try {
      await tempClient.query(migrations[0].executableSql);
      await tempClient.query("COMMIT");
    } catch (error) {
      await rollbackAndRethrow(
        tempClient,
        error,
        "Initial schema verification",
      );
    }

    await tempClient.end();
    tempClient = undefined;

    await fs.mkdir(tempDir, { recursive: true });
    const existingDump = path.join(tempDir, "existing.sql");
    const freshDump = path.join(tempDir, "fresh.sql");

    const sourceDatabase = decodeURIComponent(
      new URL(connectionString).pathname.slice(1),
    );

    await runSchemaDump(sourceDatabase, existingDump);
    await runSchemaDump(tempName, freshDump);

    if (normalizedDump(existingDump) !== normalizedDump(freshDump)) {
      throw new Error(
        "Schema reconciliation failed: existing schema differs from migration 0001. " +
        "No adoption record was written.",
      );
    }

    console.log("PASS: Existing schema matches migration 0001.");
  } catch (error) {
    verificationError = error;
  }

  const cleanupActions = [];

  if (tempClient) {
    cleanupActions.push({
      action: "Temporary verification client shutdown",
      run: () => tempClient.end(),
    });
  }

  if (created) {
    cleanupActions.push({
      action: "Temporary verification connection termination",
      run: () =>
        admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
          [tempName],
        ),
    });

    cleanupActions.push({
      action: "Temporary verification database removal",
      run: () => admin.query(`DROP DATABASE IF EXISTS "${tempName}"`),
    });
  }

  cleanupActions.push({
    action: "Verification admin client shutdown",
    run: () => admin.end(),
  });

  cleanupActions.push({
    action: "Verification temporary directory removal",
    run: () => fs.rm(tempDir, { recursive: true, force: true }),
  });

  await runCleanupActions(cleanupActions, verificationError);
}

async function commandStatus(client, migrations) {
  const exists = await ledgerExists(client);

  if (!exists) {
    console.log("Migration ledger: absent");
    console.log("No migrations are recorded.");
    return;
  }

  const applied = await readAppliedMigrations(client);
  const byName = new Map(applied.map((row) => [row.migration_id, row.checksum]));

  for (const migration of migrations) {
    const recorded = byName.get(migration.name);

    if (!recorded) {
      console.log(`PENDING  ${migration.name}`);
    } else if (recorded !== migration.checksum) {
      console.log(`CHECKSUM MISMATCH  ${migration.name}`);
      process.exitCode = 2;
    } else {
      console.log(`APPLIED  ${migration.name}`);
    }
  }

  for (const row of applied) {
    if (!migrations.some((m) => m.name === row.migration_id)) {
      console.log(`UNKNOWN RECORDED MIGRATION  ${row.migration_id}`);
      process.exitCode = 2;
    }
  }
}

async function commandMigrate(client, migrations) {
  const hasLedger = await ledgerExists(client);

  if (!hasLedger) {
    await assertEmptySchema(client);
  }

  const applied = await readAppliedMigrations(client);
  const appliedMap = new Map(
    applied.map((row) => [row.migration_id, row.checksum]),
  );

  const migrationNames = new Set(migrations.map((migration) => migration.name));

  for (const row of applied) {
    if (!migrationNames.has(row.migration_id)) {
      throw new Error(
        `Unknown recorded migration ${row.migration_id}. ` +
        "Restore its migration file or reconcile history before continuing.",
      );
    }
  }

  for (const migration of migrations) {
    if (
      appliedMap.has(migration.name) &&
      appliedMap.get(migration.name) !== migration.checksum
    ) {
      throw new Error(
        `Checksum mismatch for ${migration.name}. Refusing to continue.`,
      );
    }
  }

  let foundPendingMigration = false;

  for (const migration of migrations) {
    if (!appliedMap.has(migration.name)) {
      foundPendingMigration = true;
    } else if (foundPendingMigration) {
      throw new Error(
        `Migration history has a gap before ${migration.name}. ` +
        "Refusing to apply migrations out of order.",
      );
    }
  }

  for (const migration of migrations) {
    if (appliedMap.has(migration.name)) {
      continue;
    }

    await client.query("BEGIN");

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          migration_id TEXT PRIMARY KEY,
          checksum CHAR(64) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(migration.executableSql);

      await client.query(
        `INSERT INTO public.schema_migrations (migration_id, checksum)
         VALUES ($1, $2)`,
        [migration.name, migration.checksum],
      );

      await client.query("COMMIT");
      console.log(`APPLIED  ${migration.name}`);
    } catch (error) {
      await rollbackAndRethrow(client, error, "Migration");
    }
  }

  console.log("Migration run complete.");
}

async function commandAdoptInitial(client, migrations) {
  if (await ledgerExists(client)) {
    throw new Error("Migration ledger already exists; adoption is not applicable.");
  }

  await verifyInitialSchema(client, migrations);

  await client.query("BEGIN");

  try {
    await client.query(`
      CREATE TABLE public.schema_migrations (
        migration_id TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(
      `INSERT INTO public.schema_migrations (migration_id, checksum)
       VALUES ($1, $2)`,
      [migrations[0].name, migrations[0].checksum],
    );

    await client.query("COMMIT");
  } catch (error) {
    await rollbackAndRethrow(client, error, "Initial adoption");
  }

  console.log("ADOPTED  0001_initial_schema.sql");
  console.log("The initial migration SQL was not executed against the existing database.");
}

async function main() {
  const [command = "status", flag] = process.argv.slice(2);
  const migrations = readMigrations();

  if (!["status", "verify", "migrate", "adopt"].includes(command)) {
    throw new Error(
      "Usage: node scripts/db-migrate.mjs [status|verify|migrate|adopt --initial]",
    );
  }

  if (command === "adopt" && flag !== "--initial") {
    throw new Error("Adoption requires the explicit flag: adopt --initial");
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));

  if (!databaseName) {
    throw new Error("DATABASE_URL must specify a database name.");
  }

  const client = await connect(databaseName);

  let lockAcquired = false;
  let commandError;

  try {
    await acquireLock(client);
    lockAcquired = true;

    if (command === "status") {
      await commandStatus(client, migrations);
    } else if (command === "verify") {
      await verifyInitialSchema(client, migrations);
    } else if (command === "migrate") {
      await commandMigrate(client, migrations);
    } else {
      await commandAdoptInitial(client, migrations);
    }
  } catch (error) {
    commandError = error;
  }

  let cleanupError;

  if (lockAcquired) {
    try {
      await releaseLock(client);
    } catch (error) {
      cleanupError = error;
    }
  }

  try {
    await client.end();
  } catch (error) {
    cleanupError = cleanupError
      ? combineCleanupError(
          cleanupError,
          error,
          "Database client shutdown",
        )
      : error;
  }

  if (commandError && cleanupError) {
    throw combineCleanupError(
      commandError,
      cleanupError,
      "Database cleanup",
    );
  }

  if (commandError) {
    throw commandError;
  }

  if (cleanupError) {
    throw cleanupError;
  }
}

main().catch((error) => {
  console.error(`Migration command failed: ${error.message}`);
  process.exitCode = 1;
});
