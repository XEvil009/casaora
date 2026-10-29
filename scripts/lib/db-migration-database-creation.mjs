import { combineCleanupError } from "./db-migration-errors.mjs";

export async function createDisposableDatabaseWithAdmin({
  admin,
  name,
  url,
  onCreated,
}) {
  let database;
  let operationError;
  let ownershipCallbackFailed = false;

  try {
    if (!/^casaora_it_[a-z0-9_]+$/.test(name)) {
      throw new Error("Unsafe disposable database name");
    }

    const existing = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );

    if (existing.rowCount !== 0) {
      throw new Error("Generated database name already exists");
    }

    await admin.query(`CREATE DATABASE "${name}"`);

    database = { name, url };

    // Publish ownership immediately after confirmed creation.
    // This must happen before admin.end(), which can itself fail.
    try {
      onCreated(database);
    } catch (error) {
      operationError = error;
      ownershipCallbackFailed = true;
    }
  } catch (error) {
    operationError = error;
  }

  // If ownership publication failed, remove the database here.
  // The generated-name guard prevents unsafe identifier use.
  if (ownershipCallbackFailed && database) {
    try {
      await admin.query(
        `DROP DATABASE IF EXISTS "${database.name}"`,
      );
    } catch (cleanupError) {
      operationError = combineCleanupError(
        operationError,
        cleanupError,
        "Disposable database cleanup",
      );
    }
  }

  let shutdownError;

  try {
    await admin.end();
  } catch (error) {
    shutdownError = error;
  }

  if (operationError && shutdownError) {
    throw combineCleanupError(
      operationError,
      shutdownError,
      "Database creation client shutdown",
    );
  }

  if (operationError) {
    throw operationError;
  }

  if (shutdownError) {
    // The database was created and ownership was published.
    // Throwing triggers the caller's normal cleanup path.
    throw shutdownError;
  }

  return database;
}
