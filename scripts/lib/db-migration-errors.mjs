function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

export function combineCleanupError(primaryError, cleanupError, action) {
  const primary = asError(primaryError);
  const cleanup = asError(cleanupError);

  return new AggregateError(
    [primary, cleanup],
    `${primary.message}; additionally, ${action} failed: ${cleanup.message}`,
    { cause: primary },
  );
}

export async function rollbackAndRethrow(client, primaryError, context) {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    throw combineCleanupError(
      primaryError,
      rollbackError,
      `${context} rollback`,
    );
  }

  throw primaryError;
}

export async function runCleanupActions(actions, primaryError) {
  let combinedError = primaryError;

  for (const { action, run } of actions) {
    try {
      await run();
    } catch (cleanupError) {
      combinedError = combinedError
        ? combineCleanupError(combinedError, cleanupError, action)
        : asError(cleanupError);
    }
  }

  if (combinedError) {
    throw combinedError;
  }
}
