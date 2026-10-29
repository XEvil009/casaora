import { runCleanupActions } from "./db-migration-errors.mjs";

export async function cleanupIntegrationFixture({
  database,
  dropDatabase,
  removeFixture,
  operationError,
}) {
  const cleanupActions = [];

  if (database) {
    cleanupActions.push({
      action: "Disposable integration database removal",
      run: () => dropDatabase(database.name),
    });
  }

  cleanupActions.push({
    action: "Integration fixture directory removal",
    run: removeFixture,
  });

  await runCleanupActions(cleanupActions, operationError);
}
