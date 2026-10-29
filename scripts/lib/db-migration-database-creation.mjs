import { combineCleanupError } from "./db-migration-errors.mjs";

export async function createDisposableDatabaseWithAdmin({
  admin,
  name,
  url,
  onCreated,
}) {
  let database;
  let operationError;

  try {
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
    onCreated(database);
  } catch (error) {
    operationError = error;
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
    // Throwing still triggers the caller's normal cleanup path.
    throw shutdownError;
  }

  return database;
}
