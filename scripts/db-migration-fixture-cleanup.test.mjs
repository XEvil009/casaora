import test from "node:test";
import assert from "node:assert/strict";
import { cleanupIntegrationFixture } from "./lib/db-migration-fixture-cleanup.mjs";

test("fixture removal is attempted when disposable database removal fails", async () => {
  const operationError = new Error("migration operation failed");
  const databaseError = new Error("disposable database removal failed");
  const calls = [];

  await assert.rejects(
    cleanupIntegrationFixture({
      database: { name: "casaora_it_test" },
      async dropDatabase(name) {
        calls.push(`database:${name}`);
        throw databaseError;
      },
      async removeFixture() {
        calls.push("fixture");
      },
      operationError,
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, operationError);
      assert.deepEqual(error.errors, [operationError, databaseError]);
      assert.match(error.message, /migration operation failed/);
      assert.match(error.message, /disposable database removal failed/);
      return true;
    },
  );

  assert.deepEqual(calls, ["database:casaora_it_test", "fixture"]);
});

test("operation and both cleanup failures remain diagnosable", async () => {
  const operationError = new Error("migration operation failed");
  const databaseError = new Error("database removal failed");
  const fixtureError = new Error("fixture removal failed");
  const calls = [];

  await assert.rejects(
    cleanupIntegrationFixture({
      database: { name: "casaora_it_test" },
      async dropDatabase() {
        calls.push("database");
        throw databaseError;
      },
      async removeFixture() {
        calls.push("fixture");
        throw fixtureError;
      },
      operationError,
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /migration operation failed/);
      assert.match(error.message, /fixture removal failed/);

      assert.ok(error.cause instanceof AggregateError);
      assert.equal(error.cause.cause, operationError);
      assert.ok(error.cause.errors.includes(databaseError));
      assert.ok(error.errors.includes(fixtureError));
      return true;
    },
  );

  assert.deepEqual(calls, ["database", "fixture"]);
});

test("fixture removal runs when there is no disposable database", async () => {
  const calls = [];

  await cleanupIntegrationFixture({
    database: undefined,
    async dropDatabase() {
      calls.push("database");
    },
    async removeFixture() {
      calls.push("fixture");
    },
  });

  assert.deepEqual(calls, ["fixture"]);
});
