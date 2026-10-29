import test from "node:test";
import assert from "node:assert/strict";
import { createDisposableDatabaseWithAdmin } from "./lib/db-migration-database-creation.mjs";

test("database ownership is published before admin shutdown", async () => {
  const shutdownError = new Error("admin shutdown failed");
  const calls = [];
  let ownedDatabase;

  const admin = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });

      if (sql.startsWith("SELECT")) {
        return { rowCount: 0 };
      }

      if (sql.startsWith("CREATE DATABASE")) {
        return { rowCount: null };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },

    async end() {
      calls.push({ sql: "END" });
      assert.deepEqual(ownedDatabase, {
        name: "casaora_it_regression",
        url: "postgresql://localhost/casaora_it_regression",
      });
      throw shutdownError;
    },
  };

  await assert.rejects(
    createDisposableDatabaseWithAdmin({
      admin,
      name: "casaora_it_regression",
      url: "postgresql://localhost/casaora_it_regression",
      onCreated(database) {
        ownedDatabase = database;
      },
    }),
    (error) => error === shutdownError,
  );

  assert.deepEqual(ownedDatabase, {
    name: "casaora_it_regression",
    url: "postgresql://localhost/casaora_it_regression",
  });
  assert.equal(calls.filter((call) => call.sql === "END").length, 1);
});

test("creation and shutdown errors are both preserved", async () => {
  const creationError = new Error("database creation failed");
  const shutdownError = new Error("admin shutdown failed");
  const calls = [];

  const admin = {
    async query(sql) {
      calls.push(sql);

      if (sql.startsWith("SELECT")) {
        return { rowCount: 0 };
      }

      throw creationError;
    },

    async end() {
      calls.push("END");
      throw shutdownError;
    },
  };

  await assert.rejects(
    createDisposableDatabaseWithAdmin({
      admin,
      name: "casaora_it_regression",
      url: "postgresql://localhost/casaora_it_regression",
      onCreated() {
        assert.fail("Ownership must not be published when creation fails");
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, creationError);
      assert.deepEqual(error.errors, [creationError, shutdownError]);
      return true;
    },
  );

  assert.equal(calls.at(-1), "END");
});

test("an existing database name is not created or published", async () => {
  const calls = [];
  const admin = {
    async query(sql) {
      calls.push(sql);
      return { rowCount: 1 };
    },
    async end() {
      calls.push("END");
    },
  };

  await assert.rejects(
    createDisposableDatabaseWithAdmin({
      admin,
      name: "casaora_it_regression",
      url: "postgresql://localhost/casaora_it_regression",
      onCreated() {
        assert.fail("Existing database must not be claimed");
      },
    }),
    /Generated database name already exists/,
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[1], "END");
});

test("ownership callback failure attempts database cleanup before shutdown", async () => {
  const callbackError = new Error("ownership callback failed");
  const calls = [];

  const admin = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });

      if (sql.startsWith("SELECT")) {
        return { rowCount: 0 };
      }

      if (sql.startsWith("CREATE DATABASE")) {
        return { rowCount: null };
      }

      if (sql.startsWith("DROP DATABASE")) {
        return { rowCount: null };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },

    async end() {
      calls.push({ sql: "END" });
    },
  };

  await assert.rejects(
    createDisposableDatabaseWithAdmin({
      admin,
      name: "casaora_it_callback_failure",
      url: "postgresql://localhost/casaora_it_callback_failure",
      onCreated() {
        throw callbackError;
      },
    }),
    (error) => error === callbackError,
  );

  assert.ok(
    calls.some((call) =>
      call.sql.startsWith("DROP DATABASE"),
    ),
    "Created database should be cleaned up after callback failure",
  );

  assert.equal(calls.at(-1).sql, "END");
});

test("callback, database cleanup, and shutdown failures are all preserved", async () => {
  const callbackError = new Error("ownership callback failed");
  const cleanupError = new Error("database cleanup failed");
  const shutdownError = new Error("admin shutdown failed");
  const calls = [];

  const admin = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });

      if (sql.startsWith("SELECT")) {
        return { rowCount: 0 };
      }

      if (sql.startsWith("CREATE DATABASE")) {
        return { rowCount: null };
      }

      if (sql.startsWith("DROP DATABASE")) {
        throw cleanupError;
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },

    async end() {
      calls.push({ sql: "END" });
      throw shutdownError;
    },
  };

  await assert.rejects(
    createDisposableDatabaseWithAdmin({
      admin,
      name: "casaora_it_callback_failure",
      url: "postgresql://localhost/casaora_it_callback_failure",
      onCreated() {
        throw callbackError;
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause.cause, callbackError);
      assert.ok(error.cause.errors.includes(callbackError));
      assert.ok(error.cause.errors.includes(cleanupError));
      assert.ok(error.errors.includes(shutdownError));
      return true;
    },
  );

  assert.ok(calls.some((call) =>
    call.sql.startsWith("DROP DATABASE"),
  ));
  assert.equal(calls.at(-1).sql, "END");
});
