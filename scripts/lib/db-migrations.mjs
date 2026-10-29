import { createHash } from "node:crypto";

export function checksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function migrationVersion(name) {
  return name.match(/^\d+/)[0].replace(/^0+(?=\d)/, "");
}

export function sortMigrations(files) {
  const migrations = files.filter((name) =>
    /^\d+_[a-z0-9_-]+\.sql$/i.test(name)
  );

  const versions = migrations.map(migrationVersion);

  if (new Set(versions).size !== versions.length) {
    throw new Error("Duplicate migration version detected");
  }

  migrations.sort((a, b) => {
    const versionA = migrationVersion(a);
    const versionB = migrationVersion(b);

    if (versionA.length !== versionB.length) {
      return versionA.length - versionB.length;
    }

    if (versionA !== versionB) {
      return versionA < versionB ? -1 : 1;
    }

    return a.localeCompare(b, "en");
  });

  return migrations;
}

/**
 * Remove the explicit outer transaction statements from a migration.
 * The runner then executes the schema changes and migration-ledger
 * insertion in one database transaction.
 */
export function stripTransactionWrapper(sql) {
  let result = sql.replace(/^\uFEFF/, "");

  if (!/^\s*BEGIN;\s*(?:--[^\n]*\n\s*)?/i.test(result)) {
    throw new Error("Migration must start with BEGIN;");
  }

  if (!/COMMIT;\s*$/.test(result)) {
    throw new Error("Migration must end with COMMIT");
  }

  result = result.replace(/^\s*BEGIN;\s*/i, "");
  result = result.replace(/COMMIT;\s*$/, "");

  if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(result)) {
    throw new Error("Unexpected nested transaction statement");
  }

  return result;
}
