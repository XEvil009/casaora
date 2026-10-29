import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  copyFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runCleanupActions } from "./lib/db-migration-errors.mjs";

const { Client } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.DATABASE_URL && fs.existsSync(path.join(ROOT, ".env.local"))) {
  process.loadEnvFile(path.join(ROOT, ".env.local"));
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in .env.local or the environment.");
}

const BASE_URL = new URL(process.env.DATABASE_URL);
const BASE_DATABASE = decodeURIComponent(BASE_URL.pathname.slice(1));

if (
  !["postgres:", "postgresql:"].includes(BASE_URL.protocol) ||
  BASE_URL.hostname !== "127.0.0.1" ||
  BASE_URL.port !== "55432" ||
  BASE_DATABASE !== "casaora_migration_test"
) {
  throw new Error(
    "Safety stop: integration tests require PostgreSQL at " +
    "127.0.0.1:55432 with base database casaora_migration_test. " +
    "No test database was created."
  );
}

const ADMIN_URL = new URL(BASE_URL);
ADMIN_URL.pathname = "/postgres";

const FAILURE_SQL = `BEGIN;
CREATE TABLE public.should_rollback (
  id INTEGER PRIMARY KEY
);
THIS IS INTENTIONALLY INVALID SQL;
COMMIT;
`;

const VALID_SQL = `BEGIN;
CREATE TABLE public.integration_marker (
  id INTEGER PRIMARY KEY
);
COMMIT;
`;

const SLOW_VALID_SQL = `BEGIN;
SELECT pg_sleep(1);
CREATE TABLE public.integration_marker (
  id INTEGER PRIMARY KEY
);
COMMIT;
`;

const CHANGED_SQL = `BEGIN;
CREATE TABLE public.integration_marker (
  id INTEGER PRIMARY KEY
);
CREATE TABLE public.checksum_should_not_apply (
  id INTEGER PRIMARY KEY
);
COMMIT;
`;

function databaseUrl(databaseName) {
  const url = new URL(BASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function makeDatabaseName() {
  return `casaora_it_${process.pid}_${randomBytes(6).toString("hex")}`;
}

async function connectTo(url) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    application_name: "casaora-day33-integration-test",
  });

  await client.connect();
  return client;
}

async function createDisposableDatabase() {
  const name = makeDatabaseName();

  // Names are generated locally and checked before being used in SQL.
  assert.match(name, /^casaora_it_[a-z0-9_]+$/);

  const admin = await connectTo(ADMIN_URL.toString());

  try {
    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );

    assert.equal(existing.rowCount, 0, "Generated database name already exists");

    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  return { name, url: databaseUrl(name) };
}

async function dropDisposableDatabase(name) {
  // Never drop a database unless it matches our generated test-only prefix.
  assert.match(name, /^casaora_it_[a-z0-9_]+$/);

  const admin = await connectTo(ADMIN_URL.toString());

  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );

    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
}

async function withFixtureAndDatabase(initialSql, callback) {
  const fixture = await mkdtemp(path.join(ROOT, ".day33-integration-"));
  let database;
  let operationError;

  try {
    await mkdir(path.join(fixture, "scripts", "lib"), { recursive: true });
    await mkdir(path.join(fixture, "db", "migrations"), { recursive: true });

    await copyFile(
      path.join(ROOT, "scripts", "db-migrate.mjs"),
      path.join(fixture, "scripts", "db-migrate.mjs"),
    );

    await copyFile(
      path.join(ROOT, "scripts", "lib", "db-migrations.mjs"),
      path.join(fixture, "scripts", "lib", "db-migrations.mjs"),
    );

    await copyFile(
      path.join(ROOT, "scripts", "lib", "db-migration-errors.mjs"),
      path.join(fixture, "scripts", "lib", "db-migration-errors.mjs"),
    );

    // The fixture is nested inside the project, so Node can resolve the
    // project's existing node_modules without installing anything.
    await writeFile(
      path.join(fixture, "db", "migrations", "0001_integration_test.sql"),
      initialSql,
      "utf8",
    );

    database = await createDisposableDatabase();

    await callback({
      fixture,
      database,
      migrationPath: path.join(
        fixture,
        "db",
        "migrations",
        "0001_integration_test.sql",
      ),
    });
  } catch (error) {
    operationError = error;
  }

  const cleanupActions = [];

  if (database) {
    cleanupActions.push({
      action: "Disposable integration database removal",
      run: () => dropDisposableDatabase(database.name),
    });
  }

  cleanupActions.push({
    action: "Integration fixture directory removal",
    run: () => rm(fixture, { recursive: true, force: true }),
  });

  await runCleanupActions(cleanupActions, operationError);
}

function runMigration(fixture, databaseUrlValue) {
  const result = spawnSync(
    process.execPath,
    [path.join(fixture, "scripts", "db-migrate.mjs"), "migrate"],
    {
      cwd: fixture,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrlValue,
      },
    },
  );

  if (result.error) {
    throw result.error;
  }

  assert.notEqual(result.signal, "SIGKILL", "Migration process was killed");
  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function runMigrationAsync(fixture, databaseUrlValue) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(fixture, "scripts", "db-migrate.mjs"), "migrate"],
      {
        cwd: fixture,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrlValue,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 30000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("close", (status, signal) => {
      clearTimeout(timeout);

      resolve({
        status: timedOut ? null : status,
        signal,
        output: `${stdout}\n${stderr}`,
      });
    });
  });
}

async function readPublicState(databaseUrlValue) {
  const client = await connectTo(databaseUrlValue);

  try {
    const tables = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    const ledger = await client.query(`
      SELECT to_regclass('public.schema_migrations') AS ledger
    `);

    let migrations = [];

    if (ledger.rows[0].ledger !== null) {
      const rows = await client.query(`
        SELECT migration_id, checksum
        FROM public.schema_migrations
        ORDER BY migration_id
      `);

      migrations = rows.rows;
    }

    return {
      tables: tables.rows.map((row) => row.tablename),
      ledgerExists: ledger.rows[0].ledger !== null,
      migrations,
    };
  } finally {
    await client.end();
  }
}

test("failed migration exits unsuccessfully", async () => {
  await withFixtureAndDatabase(FAILURE_SQL, async ({ fixture, database }) => {
    const result = runMigration(fixture, database.url);

    assert.notEqual(result.status, 0, "Invalid migration unexpectedly succeeded");
    assert.match(result.output, /Migration command failed/i);
  });
});

test("failed migration rolls back schema and migration ledger", async () => {
  await withFixtureAndDatabase(FAILURE_SQL, async ({ fixture, database }) => {
    const result = runMigration(fixture, database.url);

    assert.notEqual(result.status, 0);

    const state = await readPublicState(database.url);

    assert.deepEqual(
      state.tables,
      [],
      "A failed migration left public tables behind",
    );
    assert.equal(
      state.ledgerExists,
      false,
      "A failed migration left a schema_migrations ledger behind",
    );
    assert.deepEqual(state.migrations, []);
  });
});

test("concurrent migration runs apply a migration exactly once", async () => {
  await withFixtureAndDatabase(SLOW_VALID_SQL, async ({ fixture, database }) => {
    const [first, second] = await Promise.all([
      runMigrationAsync(fixture, database.url),
      runMigrationAsync(fixture, database.url),
    ]);

    assert.equal(first.status, 0, `First runner failed:\n${first.output}`);
    assert.equal(second.status, 0, `Second runner failed:\n${second.output}`);

    const results = [first, second];
    const appliedMessages = results.filter((result) =>
      /APPLIED\s+0001_integration_test\.sql/.test(result.output),
    );

    assert.equal(
      appliedMessages.length,
      1,
      "Concurrent runners should apply the migration exactly once",
    );

    const state = await readPublicState(database.url);

    assert.ok(state.tables.includes("integration_marker"));
    assert.ok(state.ledgerExists);
    assert.equal(state.migrations.length, 1);
    assert.equal(
      state.migrations[0].migration_id,
      "0001_integration_test.sql",
    );
  });
});

test("repeated migration execution is idempotent", async () => {
  await withFixtureAndDatabase(VALID_SQL, async ({ fixture, database }) => {
    const first = runMigration(fixture, database.url);

    assert.equal(first.status, 0, first.output);
    assert.match(first.output, /APPLIED\s+0001_integration_test\.sql/);

    const stateAfterFirstRun = await readPublicState(database.url);

    const second = runMigration(fixture, database.url);

    assert.equal(second.status, 0, second.output);
    assert.doesNotMatch(
      second.output,
      /APPLIED\s+0001_integration_test\.sql/,
      "A repeated run must not reapply the migration",
    );

    const stateAfterSecondRun = await readPublicState(database.url);

    assert.deepEqual(
      stateAfterSecondRun,
      stateAfterFirstRun,
      "Repeated execution changed the database schema or migration ledger",
    );
  });
});

test("checksum mismatch refuses changed migration contents", async () => {
  await withFixtureAndDatabase(VALID_SQL, async ({
    fixture,
    database,
    migrationPath,
  }) => {
    const first = runMigration(fixture, database.url);

    assert.equal(first.status, 0, first.output);
    assert.match(first.output, /APPLIED\s+0001_integration_test\.sql/);

    await writeFile(migrationPath, CHANGED_SQL, "utf8");

    const second = runMigration(fixture, database.url);

    assert.notEqual(second.status, 0);
    assert.match(second.output, /Checksum mismatch/i);

    const state = await readPublicState(database.url);

    assert.ok(state.tables.includes("integration_marker"));
    assert.ok(!state.tables.includes("checksum_should_not_apply"));
    assert.equal(state.migrations.length, 1);
    assert.equal(state.migrations[0].migration_id, "0001_integration_test.sql");
  });
});

test("corrected migration can recover after a failed attempt", async () => {
  await withFixtureAndDatabase(FAILURE_SQL, async ({
    fixture,
    database,
    migrationPath,
  }) => {
    const failed = runMigration(fixture, database.url);

    assert.notEqual(failed.status, 0);

    const beforeRecovery = await readPublicState(database.url);
    assert.deepEqual(beforeRecovery.tables, []);
    assert.equal(beforeRecovery.ledgerExists, false);

    await writeFile(migrationPath, VALID_SQL, "utf8");

    const recovered = runMigration(fixture, database.url);

    assert.equal(recovered.status, 0, recovered.output);
    assert.match(recovered.output, /APPLIED\s+0001_integration_test\.sql/);

    const state = await readPublicState(database.url);

    assert.ok(state.tables.includes("integration_marker"));
    assert.ok(state.ledgerExists);
    assert.equal(state.migrations.length, 1);
    assert.equal(state.migrations[0].migration_id, "0001_integration_test.sql");
    assert.match(state.migrations[0].checksum, /^[a-f0-9]{64}$/);
  });
});
