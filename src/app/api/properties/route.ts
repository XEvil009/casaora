import { connection, NextResponse } from "next/server";
import { ZodError } from "zod";

import { queryDatabase } from "@/lib/db";
import {
  buildPropertySearchQuery,
  parsePropertySearchParams,
  type PropertySearchRow,
} from "@/lib/property-search";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET(request: Request) {
  // This endpoint reads live data at request time.
  await connection();

  let filters;

  try {
    const url = new URL(request.url);
    filters = parsePropertySearchParams(url.searchParams);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid property search parameters",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        {
          status: 400,
          headers: noStoreHeaders,
        },
      );
    }

    return NextResponse.json(
      { error: "Invalid property search parameters" },
      {
        status: 400,
        headers: noStoreHeaders,
      },
    );
  }

  const query = buildPropertySearchQuery(filters);

  try {
    const result = await queryDatabase<PropertySearchRow>(
      query.text,
      query.values,
    );

    return NextResponse.json(
      {
        data: result.rows,
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
          returned: result.rows.length,
        },
      },
      {
        status: 200,
        headers: noStoreHeaders,
      },
    );
  } catch {
    // Do not expose database errors, connection strings or SQL details.
    return NextResponse.json(
      { error: "Property search is temporarily unavailable" },
      {
        status: 503,
        headers: noStoreHeaders,
      },
    );
  }
}
