import test from "node:test";
import assert from "node:assert/strict";

import {
  checksum,
  sortMigrations,
  stripTransactionWrapper,
} from "./lib/db-migrations.mjs";

test("checksum is stable for the same migration contents", () => {
  assert.equal(checksum("SELECT 1;"), checksum("SELECT 1;"));
  assert.notEqual(checksum("SELECT 1;"), checksum("SELECT 2;"));
  assert.match(checksum("SELECT 1;"), /^[a-f0-9]{64}$/);
});

test("migration files are ordered by numeric version", () => {
  assert.deepEqual(
    sortMigrations([
      "0010_add_index.sql",
      "0002_add_property.sql",
      "README.md",
      "0001_initial_schema.sql",
    ]),
    [
      "0001_initial_schema.sql",
      "0002_add_property.sql",
      "0010_add_index.sql",
    ],
  );
});

test("duplicate numeric versions are rejected, including leading zeros", () => {
  assert.throws(
    () => sortMigrations([
      "0001_initial_schema.sql",
      "1_second_schema.sql",
    ]),
    /Duplicate migration version/,
  );

  assert.throws(
    () => sortMigrations([
      "01_first.sql",
      "001_second.sql",
    ]),
    /Duplicate migration version/,
  );
});

test("outer transaction statements are removed for runner-managed transactions", () => {
  const input = "BEGIN;\nCREATE TABLE example (id INT);\nCOMMIT;\n";

  assert.equal(
    stripTransactionWrapper(input),
    "CREATE TABLE example (id INT);\n",
  );
});

test("missing transaction boundaries are rejected", () => {
  assert.throws(
    () => stripTransactionWrapper("CREATE TABLE example (id INT);"),
    /start with BEGIN/,
  );

  assert.throws(
    () => stripTransactionWrapper("BEGIN;\nSELECT 1;"),
    /end with COMMIT/,
  );
});

test("nested transaction statements are rejected", () => {
  assert.throws(
    () => stripTransactionWrapper("BEGIN;\nSELECT 1;\nBEGIN;\nCOMMIT;"),
    /nested transaction/,
  );
});
