import test from "node:test";
import assert from "node:assert/strict";
import {
  combineCleanupError,
  rollbackAndRethrow,
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
