import { mockProperties } from "@/data/mock-properties";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const knownPropertyIds = new Set(
  mockProperties.map((property) => property.id),
);

function propertyNotFoundResponse(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Property unavailable | CASAORA</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      color: #202820;
      background: #f8f8f4;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; }
    header {
      padding: 24px;
      border-bottom: 1px solid #e2e4dc;
      background: #fff;
    }
    header a {
      color: inherit;
      font-size: 1.25rem;
      font-weight: 700;
      text-decoration: none;
    }
    main {
      width: min(100% - 32px, 760px);
      margin: 64px auto;
      padding: 32px;
      border: 1px solid #e2e4dc;
      border-radius: 16px;
      background: #fff;
    }
    .notice { color: #59634f; font-weight: 700; }
    h1 { line-height: 1.2; }
    p { line-height: 1.7; }
    .button {
      display: inline-block;
      margin-top: 12px;
      padding: 12px 18px;
      border-radius: 8px;
      background: #26372b;
      color: #fff;
      text-decoration: none;
    }
    @media (max-width: 480px) {
      main { margin-top: 28px; padding: 22px; }
    }
  </style>
</head>
<body>
  <header>
    <a href="/">CASAORA</a>
    <p>One Property. One Network. Every Opportunity.</p>
  </header>
  <main>
    <p class="notice">Property unavailable</p>
    <h1>We couldn't find that property</h1>
    <p>
      This address does not match a property in the current
      CASAORA development preview.
    </p>
    <p>
      The listing may have an incorrect address or may no longer
      be available in this sample dataset.
    </p>
    <a class="button" href="/#discover">Explore properties</a>
    <p><a href="/">Return to the CASAORA homepage</a></p>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export function proxy(request: NextRequest) {
  const match = request.nextUrl.pathname.match(
    /^\/properties\/([^/]+)\/?$/,
  );

  if (!match) {
    return NextResponse.next();
  }

  let propertyId: string;

  try {
    propertyId = decodeURIComponent(match[1]);
  } catch {
    return propertyNotFoundResponse();
  }

  if (!knownPropertyIds.has(propertyId)) {
    return propertyNotFoundResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/properties/:id"],
};
