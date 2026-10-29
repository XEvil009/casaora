import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDisposableDatabaseWithAdmin } from "./lib/db-migration-database-creation.mjs";

const { Client } = pg;
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

if (
  !process.env.DATABASE_URL &&
  fs.existsSync(path.join(ROOT, ".env.local"))
) {
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
    "Safety stop: schema integration tests require PostgreSQL at " +
      "127.0.0.1:55432 with database casaora_migration_test. " +
      "No disposable database was created.",
  );
}

const ADMIN_URL = new URL(BASE_URL);
ADMIN_URL.pathname = "/postgres";

const MIGRATION_PATH = path.join(
  ROOT,
  "db",
  "migrations",
  "0001_initial_schema.sql",
);

function databaseUrl(databaseName) {
  const url = new URL(BASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function connectTo(url, applicationName) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    application_name: applicationName,
  });

  await client.connect();
  return client;
}

async function createDisposableDatabase() {
  const name =
    `casaora_it_${process.pid}_${randomBytes(6).toString("hex")}`;

  assert.match(name, /^casaora_it_[a-z0-9_]+$/);

  const admin = await connectTo(
    ADMIN_URL.toString(),
    "casaora-schema-test-admin",
  );

  let ownedDatabase;

  try {
    const database = await createDisposableDatabaseWithAdmin({
      admin,
      name,
      url: databaseUrl(name),
      onCreated(createdDatabase) {
        ownedDatabase = createdDatabase;
      },
    });

    return database;
  } catch (error) {
    if (ownedDatabase) {
      try {
        await dropDisposableDatabase(ownedDatabase.name);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Database creation failed and cleanup also failed.",
          { cause: error },
        );
      }
    }

    throw error;
  }
}

async function dropDisposableDatabase(name) {
  assert.match(name, /^casaora_it_[a-z0-9_]+$/);

  const admin = await connectTo(
    ADMIN_URL.toString(),
    "casaora-schema-test-cleanup",
  );

  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1
         AND pid <> pg_backend_pid()`,
      [name],
    );

    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end();
  }
}

async function expectPgError(operation, expectedCode, messagePattern) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, expectedCode, error.message);

    if (messagePattern) {
      assert.match(error.message, messagePattern);
    }

    return true;
  });
}

test(
  "initial CASAORA schema enforces structure and critical database rules",
  { timeout: 60000 },
  async () => {
    assert.ok(
      fs.existsSync(MIGRATION_PATH),
      `Missing migration file: ${MIGRATION_PATH}`,
    );

    const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");
    let database;
    let client;

    try {
      database = await createDisposableDatabase();

      client = await connectTo(
        database.url,
        "casaora-schema-integration-test",
      );

      // Execute the actual repository migration, not a copied schema.
      await client.query(migrationSql);

      // 1. Verify all core tables.
      const tableResult = await client.query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
      `);

      const tables = new Set(
        tableResult.rows.map((row) => row.tablename),
      );

      const requiredTables = [
        "app_users",
        "properties",
        "property_listings",
        "property_brokers",
        "customer_requirement_queues",
        "queue_versions",
        "property_transactions",
        "payments",
        "financial_ledger_entries",
        "reward_events",
        "notifications",
        "audit_events",
      ];

      for (const table of requiredTables) {
        assert.ok(tables.has(table), `Missing table: ${table}`);
      }

      // 2. Verify domain enums and their values.
      const enumResult = await client.query(`
        SELECT
          t.typname AS enum_name,
          json_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        GROUP BY t.typname
      `);

      const enums = new Map(
        enumResult.rows.map((row) => [row.enum_name, row.labels]),
      );

      const requiredEnums = [
        "casaora_user_role",
        "casaora_listing_type",
        "casaora_listing_status",
        "casaora_queue_status",
        "casaora_transaction_status",
        "casaora_payment_status",
        "casaora_ledger_entry_type",
      ];

      for (const enumName of requiredEnums) {
        assert.ok(enums.has(enumName), `Missing enum: ${enumName}`);
      }

      assert.deepEqual(
        enums.get("casaora_user_role"),
        ["broker", "customer", "administrator"],
      );

      assert.deepEqual(
        enums.get("casaora_listing_type"),
        ["sale", "rent"],
      );

      // 3. Verify important indexes and foreign-key relationships.
      const indexResult = await client.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
      `);

      const indexes = new Set(
        indexResult.rows.map((row) => row.indexname),
      );

      for (const indexName of [
        "app_users_email_lower_unique",
        "queue_versions_one_active_per_queue",
        "property_brokers_pkey",
      ]) {
        assert.ok(indexes.has(indexName), `Missing index: ${indexName}`);
      }

      const foreignKeys = await client.query(`
        SELECT COUNT(*)::integer AS count
        FROM pg_constraint
        WHERE contype = 'f'
          AND connamespace = 'public'::regnamespace
      `);

      assert.ok(
        foreignKeys.rows[0].count >= 10,
        `Expected at least 10 foreign keys, found ${foreignKeys.rows[0].count}`,
      );

      // 4. Create test users and a canonical property.
      const brokerResult = await client.query(
        `INSERT INTO app_users (email, role, display_name)
         VALUES ($1, 'broker', 'Schema Test Broker')
         RETURNING id`,
        [`broker-${randomBytes(5).toString("hex")}@example.test`],
      );

      const customerResult = await client.query(
        `INSERT INTO app_users (email, role, display_name)
         VALUES ($1, 'customer', 'Schema Test Customer')
         RETURNING id`,
        [`customer-${randomBytes(5).toString("hex")}@example.test`],
      );

      const brokerId = brokerResult.rows[0].id;
      const customerId = customerResult.rows[0].id;

      const propertyResult = await client.query(
        `INSERT INTO properties (
           canonical_key, locality, pin_code, bhk, created_by
         )
         VALUES ($1, 'Salt Lake', '700091', 2, $2)
         RETURNING id`,
        [`schema-test-${randomBytes(6).toString("hex")}`, brokerId],
      );

      const propertyId = propertyResult.rows[0].id;

      // 5. Duplicate canonical property keys must be rejected.
      const property = await client.query(
        `SELECT canonical_key FROM properties WHERE id = $1`,
        [propertyId],
      );

      await expectPgError(
        client.query(
          `INSERT INTO properties (canonical_key, locality, pin_code)
           VALUES ($1, 'New Town', '700156')`,
          [property.rows[0].canonical_key],
        ),
        "23505",
      );

      // 6. Invalid listing prices must be rejected.
      await expectPgError(
        client.query(
          `INSERT INTO property_listings (
             property_id, broker_id, title, listing_type, price_in_rupees
           )
           VALUES ($1, $2, 'Invalid Price Test', 'sale', 0)`,
          [propertyId, brokerId],
        ),
        "23514",
      );

      // 7. A queue can have only one active version.
      const queueOne = await client.query(
        `INSERT INTO customer_requirement_queues (customer_id)
         VALUES ($1)
         RETURNING id`,
        [customerId],
      );

      const queueOneId = queueOne.rows[0].id;

      await client.query(
        `INSERT INTO queue_versions (
           queue_id, version_number, status, listing_type, locality
         )
         VALUES ($1, 1, 'active', 'sale', 'Salt Lake')`,
        [queueOneId],
      );

      await expectPgError(
        client.query(
          `INSERT INTO queue_versions (
             queue_id, version_number, status, listing_type, locality
           )
           VALUES ($1, 2, 'active', 'sale', 'New Town')`,
          [queueOneId],
        ),
        "23505",
      );

      // 8. Pausing the old version permits a new active version
      // without deleting the historical record.
      await client.query(
        `UPDATE queue_versions
         SET status = 'paused'
         WHERE queue_id = $1 AND version_number = 1`,
        [queueOneId],
      );

      await client.query(
        `INSERT INTO queue_versions (
           queue_id, version_number, status, listing_type, locality
         )
         VALUES ($1, 2, 'active', 'sale', 'New Town')`,
        [queueOneId],
      );

      const versionHistory = await client.query(
        `SELECT version_number, status
         FROM queue_versions
         WHERE queue_id = $1
         ORDER BY version_number`,
        [queueOneId],
      );

      assert.deepEqual(
        versionHistory.rows.map((row) => ({
          version_number: row.version_number,
          status: row.status,
        })),
        [
          { version_number: 1, status: "paused" },
          { version_number: 2, status: "active" },
        ],
      );

      // 9. Two active queues are allowed; a third must be rejected.
      const queueTwo = await client.query(
        `INSERT INTO customer_requirement_queues (customer_id)
         VALUES ($1)
         RETURNING id`,
        [customerId],
      );

      const queueTwoId = queueTwo.rows[0].id;

      await client.query(
        `INSERT INTO queue_versions (
           queue_id, version_number, status, listing_type, locality
         )
         VALUES ($1, 1, 'active', 'rent', 'Behala')`,
        [queueTwoId],
      );

      const queueThree = await client.query(
        `INSERT INTO customer_requirement_queues (customer_id)
         VALUES ($1)
         RETURNING id`,
        [customerId],
      );

      await expectPgError(
        client.query(
          `INSERT INTO queue_versions (
             queue_id, version_number, status, listing_type, locality
           )
           VALUES ($1, 1, 'active', 'sale', 'Garia')`,
          [queueThree.rows[0].id],
        ),
        "23514",
        /cannot have more than two active requirement queues/i,
      );

      const activeQueues = await client.query(
        `SELECT COUNT(*)::integer AS count
         FROM queue_versions qv
         JOIN customer_requirement_queues q ON q.id = qv.queue_id
         WHERE q.customer_id = $1
           AND qv.status = 'active'`,
        [customerId],
      );

      assert.equal(activeQueues.rows[0].count, 2);

      console.log("PASS: all 12 core tables exist.");
      console.log("PASS: required enums, indexes and foreign keys exist.");
      console.log("PASS: canonical property uniqueness is enforced.");
      console.log("PASS: invalid listing prices are rejected.");
      console.log("PASS: active queue versions and queue limits are enforced.");
      console.log("PASS: queue version history is preserved.");
    } finally {
      // Close the application connection before dropping its database.
      try {
        if (client) {
          await client.end();
        }
      } finally {
        if (database) {
          await dropDisposableDatabase(database.name);
        }
      }
    }
  },
);
