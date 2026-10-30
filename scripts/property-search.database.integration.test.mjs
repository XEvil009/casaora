import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildPropertySearchQuery,
  parsePropertySearchParams,
} from "../src/lib/property-search.ts";

import {
  createDisposableDatabaseWithAdmin,
} from "./lib/db-migration-database-creation.mjs";

import {
  cleanupIntegrationFixture,
} from "./lib/db-migration-fixture-cleanup.mjs";

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
  throw new Error(
    "DATABASE_URL is required in .env.local or the environment.",
  );
}

const BASE_URL = new URL(process.env.DATABASE_URL);
const BASE_DATABASE = decodeURIComponent(
  BASE_URL.pathname.slice(1),
);

if (
  !["postgres:", "postgresql:"].includes(BASE_URL.protocol) ||
  BASE_URL.hostname !== "127.0.0.1" ||
  BASE_URL.port !== "55432" ||
  BASE_DATABASE !== "casaora_migration_test"
) {
  throw new Error(
    "Safety stop: property-search integration tests require " +
      "PostgreSQL at 127.0.0.1:55432 with database " +
      "casaora_migration_test. No disposable database was created.",
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

async function dropDisposableDatabase(name) {
  assert.match(name, /^casaora_it_[a-z0-9_]+$/);

  const admin = await connectTo(
    ADMIN_URL.toString(),
    "casaora-property-search-cleanup",
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

async function createDisposableDatabase() {
  const name =
    `casaora_it_${process.pid}_${randomBytes(6).toString("hex")}`;

  assert.match(name, /^casaora_it_[a-z0-9_]+$/);

  const admin = await connectTo(
    ADMIN_URL.toString(),
    "casaora-property-search-admin",
  );

  let ownedDatabase;

  try {
    return await createDisposableDatabaseWithAdmin({
      admin,
      name,
      url: databaseUrl(name),
      onCreated(database) {
        ownedDatabase = database;
      },
    });
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

async function insertProperty(
  client,
  brokerId,
  {
    locality,
    pinCode,
    bhk,
    areaSqFt,
  },
) {
  const result = await client.query(
    `INSERT INTO properties (
       canonical_key,
       locality,
       pin_code,
       bhk,
       area_sq_ft,
       created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      `property-search-${randomBytes(8).toString("hex")}`,
      locality,
      pinCode,
      bhk,
      areaSqFt,
      brokerId,
    ],
  );

  return result.rows[0].id;
}

async function insertListing(
  client,
  brokerId,
  propertyId,
  {
    title,
    listingType,
    price,
    status,
    createdAt,
  },
) {
  const result = await client.query(
    `INSERT INTO property_listings (
       property_id,
       broker_id,
       title,
       listing_type,
       price_in_rupees,
       status,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      propertyId,
      brokerId,
      title,
      listingType,
      price,
      status,
      createdAt,
    ],
  );

  return result.rows[0].id;
}

async function executePropertySearch(client, queryString = "") {
  const filters = parsePropertySearchParams(
    new URLSearchParams(queryString),
  );

  const query = buildPropertySearchQuery(filters);

  return client.query(query.text, query.values);
}

async function findAvailablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function stopProductionServer(child) {
  if (
    !child ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }

  const exitedGracefully = new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, 5000);

    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }

    child.once("exit", onExit);
  });

  child.kill("SIGTERM");

  const exited = await exitedGracefully;

  if (
    !exited &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    const forcedExit = once(child, "exit");
    child.kill("SIGKILL");
    await forcedExit;
  }
}

async function startProductionServer(databaseUrl) {
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname", "127.0.0.1",
      "--port", String(port),
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: databaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  const deadline = Date.now() + 30000;
  let lastError;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Production server exited early.\n${output}`);
      }
      try {
        const response = await fetch(`${baseUrl}/`, {
          signal: AbortSignal.timeout(2000),
        });
        await response.arrayBuffer();
        if (response.status === 200) return { child, baseUrl };
        lastError = new Error(`Homepage returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await delay(250);
    }
    throw new Error(`Production server startup timed out: ${lastError}\n${output}`);
  } catch (error) {
    await stopProductionServer(child);
    throw error;
  }
}

test(
  "actual property-search query returns correct PostgreSQL results",
  { timeout: 60000 },
  async () => {
    assert.ok(
      fs.existsSync(MIGRATION_PATH),
      `Missing migration file: ${MIGRATION_PATH}`,
    );

    const migrationSql = fs.readFileSync(MIGRATION_PATH, "utf8");

    let database;
    let client;
    let server;
    let operationError;

    try {
      database = await createDisposableDatabase();

      client = await connectTo(
        database.url,
        "casaora-property-search-integration",
      );

      // Apply the actual repository migration.
      await client.query(migrationSql);

      // Create a broker used by the listing fixtures.
      const brokerResult = await client.query(
        `INSERT INTO app_users (
           email,
           role,
           display_name
         )
         VALUES ($1, 'broker', 'Property Search Test Broker')
         RETURNING id`,
        [
          `property-search-${randomBytes(8).toString("hex")}@example.test`,
        ],
      );

      const brokerId = brokerResult.rows[0].id;

      // Create canonical properties.
      const saltLakeTwoBhk = await insertProperty(
        client,
        brokerId,
        {
          locality: "Salt Lake",
          pinCode: "700091",
          bhk: 2,
          areaSqFt: 1200,
        },
      );

      const saltLakeThreeBhk = await insertProperty(
        client,
        brokerId,
        {
          locality: "Salt Lake",
          pinCode: "700091",
          bhk: 3,
          areaSqFt: 1500,
        },
      );

      const newTownTwoBhk = await insertProperty(
        client,
        brokerId,
        {
          locality: "New Town",
          pinCode: "700156",
          bhk: 2,
          areaSqFt: 1100,
        },
      );

      // Create listings with controlled timestamps for stable ordering.
      const fixtures = [
        {
          propertyId: saltLakeTwoBhk,
          title: "Salt Lake Sale Published",
          listingType: "sale",
          price: "8000000.00",
          status: "published",
          createdAt: "2026-03-04T10:00:00Z",
        },
        {
          propertyId: saltLakeThreeBhk,
          title: "Salt Lake Rent Published",
          listingType: "rent",
          price: "35000.00",
          status: "published",
          createdAt: "2026-03-03T10:00:00Z",
        },
        {
          propertyId: newTownTwoBhk,
          title: "New Town Rent Published",
          listingType: "rent",
          price: "25000.00",
          status: "published",
          createdAt: "2026-03-02T10:00:00Z",
        },
        {
          propertyId: saltLakeTwoBhk,
          title: "Salt Lake Draft",
          listingType: "sale",
          price: "7000000.00",
          status: "draft",
          createdAt: "2026-03-07T10:00:00Z",
        },
        {
          propertyId: saltLakeTwoBhk,
          title: "Salt Lake Paused",
          listingType: "sale",
          price: "7000000.00",
          status: "paused",
          createdAt: "2026-03-06T10:00:00Z",
        },
        {
          propertyId: saltLakeTwoBhk,
          title: "Salt Lake Closed",
          listingType: "sale",
          price: "7000000.00",
          status: "closed",
          createdAt: "2026-03-05T10:00:00Z",
        },
      ];

      const listingIds = new Map();

      for (const fixture of fixtures) {
        const id = await insertListing(
          client,
          brokerId,
          fixture.propertyId,
          fixture,
        );

        listingIds.set(fixture.title, id);
      }

      // Exercise the real Next.js API against this disposable database.
      server = await startProductionServer(database.url);

      const healthResponse = await fetch(`${server.baseUrl}/api/health`);
      assert.equal(healthResponse.status, 200);
      const healthBody = await healthResponse.json();
      assert.equal(healthBody.status, "ok");
      assert.equal(healthBody.service, "casaora");
      assert.equal(typeof healthBody.timestamp, "string");
      assert.ok(Number.isFinite(Date.parse(healthBody.timestamp)));
      assert.deepEqual(healthBody.checks, { database: "ok" });

      const apiResponse = await fetch(`${server.baseUrl}/api/properties`);
      assert.equal(apiResponse.status, 200);
      assert.match(apiResponse.headers.get("cache-control") ?? "", /no-store/i);
      const apiBody = await apiResponse.json();
      assert.deepEqual(
        apiBody.data.map((row) => row.title),
        [
          "Salt Lake Sale Published",
          "Salt Lake Rent Published",
          "New Town Rent Published",
        ],
      );
      assert.deepEqual(apiBody.pagination, {
        limit: 20,
        offset: 0,
        returned: 3,
      });

      const saleResponse = await fetch(
        `${server.baseUrl}/api/properties?listingType=sale`,
      );
      assert.equal(saleResponse.status, 200);
      const saleBody = await saleResponse.json();
      assert.deepEqual(
        saleBody.data.map((row) => row.title),
        ["Salt Lake Sale Published"],
      );

      const localityResponse = await fetch(
        `${server.baseUrl}/api/properties?locality=New%20Town`,
      );
      assert.equal(localityResponse.status, 200);
      const localityBody = await localityResponse.json();
      assert.deepEqual(
        localityBody.data.map((row) => row.title),
        ["New Town Rent Published"],
      );

      const pageResponse = await fetch(
        `${server.baseUrl}/api/properties?limit=1&offset=1`,
      );
      assert.equal(pageResponse.status, 200);
      const pageBody = await pageResponse.json();
      assert.deepEqual(
        pageBody.data.map((row) => row.title),
        ["Salt Lake Rent Published"],
      );
      assert.deepEqual(pageBody.pagination, {
        limit: 1,
        offset: 1,
        returned: 1,
      });

      console.log("PASS: production health endpoint confirms PostgreSQL readiness.");
      console.log("PASS: property-search HTTP endpoint returns published PostgreSQL fixtures.");
      console.log("PASS: property-search HTTP filters and pagination work.");

      // 1. Only published listings are visible.
      const defaultSearch = await executePropertySearch(client);

      assert.deepEqual(
        defaultSearch.rows.map((row) => row.title),
        [
          "Salt Lake Sale Published",
          "Salt Lake Rent Published",
          "New Town Rent Published",
        ],
      );

      assert.equal(defaultSearch.rows.length, 3);

      for (const row of defaultSearch.rows) {
        assert.ok(
          fixtures.some(
            (fixture) =>
              fixture.title === row.title &&
              fixture.status === "published",
          ),
          `Unexpected non-published result: ${row.title}`,
        );
      }

      // 2. Canonical property join returns the correct property identity.
      const saleSearch = await executePropertySearch(
        client,
        "listingType=sale",
      );

      assert.equal(saleSearch.rows.length, 1);
      assert.equal(
        saleSearch.rows[0].propertyId,
        saltLakeTwoBhk,
      );
      assert.equal(
        saleSearch.rows[0].id,
        listingIds.get("Salt Lake Sale Published"),
      );

      // 3. All supported filters work together.
      const combinedSearch = await executePropertySearch(
        client,
        "listingType=rent&locality=Salt%20Lake" +
          "&pinCode=700091&bhk=3&maxBudget=50000",
      );

      assert.deepEqual(
        combinedSearch.rows.map((row) => row.title),
        ["Salt Lake Rent Published"],
      );

      // 4. Locality filter.
      const localitySearch = await executePropertySearch(
        client,
        "locality=New%20Town",
      );

      assert.deepEqual(
        localitySearch.rows.map((row) => row.title),
        ["New Town Rent Published"],
      );

      // 5. PIN-code filter.
      const pinSearch = await executePropertySearch(
        client,
        "pinCode=700091",
      );

      assert.deepEqual(
        pinSearch.rows.map((row) => row.title),
        [
          "Salt Lake Sale Published",
          "Salt Lake Rent Published",
        ],
      );

      // 6. BHK filter.
      const bhkSearch = await executePropertySearch(
        client,
        "bhk=2",
      );

      assert.deepEqual(
        bhkSearch.rows.map((row) => row.title),
        [
          "Salt Lake Sale Published",
          "New Town Rent Published",
        ],
      );

      // 7. Maximum-budget filter.
      const budgetSearch = await executePropertySearch(
        client,
        "maxBudget=30000",
      );

      assert.deepEqual(
        budgetSearch.rows.map((row) => row.title),
        ["New Town Rent Published"],
      );

      // 8. Numeric prices remain exact decimal strings.
      assert.equal(
        saleSearch.rows[0].priceInRupees,
        "8000000.00",
      );

      // 9. Ordering and pagination are deterministic.
      const pageSearch = await executePropertySearch(
        client,
        "limit=1&offset=1",
      );

      assert.equal(pageSearch.rows.length, 1);
      assert.equal(
        pageSearch.rows[0].title,
        "Salt Lake Rent Published",
      );

      // 10. SQL injection payload is bound as data, not executed.
      const payload =
        "Salt Lake' OR 1=1; DROP TABLE properties; --";

      const injectionFilters = parsePropertySearchParams(
        new URLSearchParams(),
      );

      const injectionQuery = buildPropertySearchQuery({
        ...injectionFilters,
        locality: payload,
      });

      assert.ok(injectionQuery.values.includes(payload));
      assert.ok(!injectionQuery.text.includes(payload));

      const injectionResult = await client.query(
        injectionQuery.text,
        injectionQuery.values,
      );

      assert.equal(injectionResult.rows.length, 0);

      // Confirm the canonical properties table still exists.
      const tableCheck = await client.query(
        `SELECT COUNT(*)::integer AS count
         FROM properties`,
      );

      assert.equal(tableCheck.rows[0].count, 3);

      console.log(
        "PASS: published-only visibility is enforced by the actual search query.",
      );
      console.log(
        "PASS: canonical property joins return the correct property IDs.",
      );
      console.log(
        "PASS: listing type, locality, PIN, BHK and budget filters work.",
      );
      console.log(
        "PASS: PostgreSQL numeric prices retain exact decimal strings.",
      );
      console.log(
        "PASS: deterministic ordering and pagination work.",
      );
      console.log(
        "PASS: SQL injection payloads remain parameterized.",
      );
    } catch (error) {
      operationError = error;
    }

    if (server) {
      try {
        await stopProductionServer(server.child);
      } catch (error) {
        operationError = operationError
          ? new AggregateError([operationError, error], "Test and HTTP server shutdown failed.")
          : error;
      }
    }

    if (client) {
      try {
        await client.end();
      } catch (error) {
        operationError = operationError
          ? new AggregateError(
              [operationError, error],
              "Property-search test and client shutdown failed.",
            )
          : error;
      }
    }

    await cleanupIntegrationFixture({
      database,
      dropDatabase: dropDisposableDatabase,
      removeFixture: async () => {},
      operationError,
    });
  },
);
