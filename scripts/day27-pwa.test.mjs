import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("App Router manifest declares CASAORA installation metadata", async () => {
  const source = await read("../src/app/manifest.ts");

  assert.match(source, /name:\s*"CASAORA/);
  assert.match(source, /short_name:\s*"CASAORA"/);
  assert.match(source, /start_url:\s*"\/"/);
  assert.match(source, /display:\s*"standalone"/);
  assert.match(source, /lang:\s*"en-IN"/);
  assert.match(source, /casaora-icon\.svg/);
});

test("CASAORA icon is a validly structured SVG source", async () => {
  const source = await read("../public/casaora-icon.svg");

  assert.match(source, /<svg\b/);
  assert.match(source, /viewBox="0 0 512 512"/);
  assert.match(source, /<\/svg>/);
});

test("health endpoint returns a non-cacheable status response", async () => {
  const source = await read("../src/app/api/health/route.ts");

  assert.match(source, /export function GET/);
  assert.match(source, /status:\s*"ok"/);
  assert.match(source, /service:\s*"casaora"/);
  assert.match(source, /toISOString\(\)/);
  assert.match(source, /Cache-Control/);
  assert.match(source, /no-store/);
});

test("deployment notes distinguish the preview from production workflows", async () => {
  const source = await read("../DAY27-DEPLOYMENT.md");

  assert.match(source, /sample property data/i);
  assert.match(source, /Never commit/i);
  assert.match(source, /does not check a database/i);
  assert.match(source, /HTTPS/i);
});

test("environment template contains no credential values", async () => {
  const source = await read("../.env.example");

  assert.match(source, /NEXT_PUBLIC_APP_URL=http:\/\/localhost:3000/);
  assert.doesNotMatch(
    source,
    /(?:PASSWORD|SECRET|PRIVATE_KEY|ACCESS_TOKEN)\s*=\s*\S+/i,
  );
});
