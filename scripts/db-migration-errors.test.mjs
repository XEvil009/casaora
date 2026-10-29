import test from "node:test";
import assert from "node:assert/strict";
import {
  combineCleanupError,
  rollbackAndRethrow,
  runCleanupActions,
} from "./lib/db-migration-errors.mjs";

test("cleanup failure preserves the primary error as its cause", () => {
  const primary = new Error("migration execution failed");
  const cleanup = new Error("rollback connection failed");

  const combined = combineCleanupError(
    primary,
    cleanup,
    "Migration rollback",
  );

  assert.ok(combined instanceof AggregateError);
  assert.equal(combined.cause, primary);
  assert.deepEqual(combined.errors, [primary, cleanup]);
  assert.match(combined.message, /migration execution failed/);
  assert.match(combined.message, /Migration rollback failed/);
  assert.match(combined.message, /rollback connection failed/);
});

test("successful rollback rethrows the original migration error", async () => {
  const primary = new Error("invalid migration SQL");
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
    },
  };

  await assert.rejects(
    rollbackAndRethrow(client, primary, "Migration"),
    (error) => error === primary,
  );

  assert.deepEqual(statements, ["ROLLBACK"]);
});

test("failed rollback reports both the migration and rollback errors", async () => {
  const primary = new Error("invalid migration SQL");
  const rollbackFailure = new Error("connection terminated");

  const client = {
    async query(sql) {
      assert.equal(sql, "ROLLBACK");
      throw rollbackFailure;
    },
  };

  await assert.rejects(
    rollbackAndRethrow(client, primary, "Migration"),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, primary);
      assert.deepEqual(error.errors, [primary, rollbackFailure]);
      assert.match(error.message, /invalid migration SQL/);
      assert.match(error.message, /Migration rollback failed/);
      assert.match(error.message, /connection terminated/);
      return true;
    },
  );
});

test("non-Error failures are represented in cleanup diagnostics", () => {
  const combined = combineCleanupError(
    "primary failure",
    "cleanup failure",
    "database cleanup",
  );

  assert.equal(combined.cause.message, "primary failure");
  assert.match(combined.message, /primary failure/);
  assert.match(combined.message, /cleanup failure/);
});

test("all cleanup actions run even when an earlier action fails", async () => {
  const calls = [];
  const cleanupFailure = new Error("temporary database drop failed");

  await assert.rejects(
    runCleanupActions([
      {
        action: "temporary database removal",
        async run() {
          calls.push("drop");
          throw cleanupFailure;
        },
      },
      {
        action: "temporary directory removal",
        async run() {
          calls.push("directory");
        },
      },
    ]),
    (error) => {
      assert.equal(error, cleanupFailure);
      return true;
    },
  );

  assert.deepEqual(calls, ["drop", "directory"]);
});

test("cleanup failure preserves the primary verification error", async () => {
  const primary = new Error("schema reconciliation failed");
  const cleanup = new Error("temporary database drop failed");

  await assert.rejects(
    runCleanupActions([
      {
        action: "temporary database removal",
        async run() {
          throw cleanup;
        },
      },
    ], primary),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, primary);
      assert.equal(error.errors[0].cause, undefined);
      assert.match(error.message, /schema reconciliation failed/);
      assert.match(error.message, /temporary database removal failed/);
      assert.match(error.message, /temporary database drop failed/);
      return true;
    },
  );
});

test("multiple cleanup failures are all retained", async () => {
  const primary = new Error("verification failed");
  const first = new Error("client shutdown failed");
  const second = new Error("directory removal failed");

  await assert.rejects(
    runCleanupActions([
      {
        action: "client shutdown",
        async run() {
          throw first;
        },
      },
      {
        action: "directory removal",
        async run() {
          throw second;
        },
      },
    ], primary),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /verification failed/);
      assert.match(error.message, /client shutdown failed/);
      assert.match(error.message, /directory removal failed/);

      assert.ok(error.cause instanceof AggregateError);
      assert.equal(error.cause.cause, primary);
      assert.ok(error.cause.errors.includes(first));
      assert.ok(error.errors.includes(second));

      return true;
    },
  );
});

test("cleanup actions succeed without raising an error", async () => {
  const calls = [];

  await runCleanupActions([
    {
      action: "client shutdown",
      async run() {
        calls.push("client");
      },
    },
    {
      action: "directory removal",
      async run() {
        calls.push("directory");
      },
    },
  ]);

  assert.deepEqual(calls, ["client", "directory"]);
});
