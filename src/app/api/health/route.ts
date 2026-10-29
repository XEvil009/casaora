import { connection, NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db";

export async function GET() {
  // Ensure database readiness is checked at request time,
  // not during production prerendering.
  await connection();

  const databaseReady = await checkDatabase();

  return NextResponse.json(
    {
      status: databaseReady ? "ok" : "degraded",
      service: "casaora",
      timestamp: new Date().toISOString(),
      checks: {
        database: databaseReady ? "ok" : "unavailable",
      },
    },
    {
      status: databaseReady ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
