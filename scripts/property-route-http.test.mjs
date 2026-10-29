import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";

const HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 30000;

let serverProcess;
let baseUrl;
let serverOutput = "";
let allocatedPort;

async function findAvailablePort() {
  const server = createServer();

  server.listen(0, HOST);
  await once(server, "listening");

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  const port = address.port;

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  return port;
}

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `Production server exited early.\n${serverOutput}`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(2000),
      });

      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }

      await response.arrayBuffer();
      lastError = new Error(
        `Homepage returned HTTP ${response.status}`,
      );
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new Error(
    `Production server did not become ready: ${lastError}\n` +
      serverOutput,
  );
}

before(async () => {
  allocatedPort = await findAvailablePort();
  baseUrl = `http://${HOST}:${allocatedPort}`;

  serverProcess = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      HOST,
      "--port",
      String(allocatedPort),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://casaora_test:casaora_test@127.0.0.1:1/casaora_test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  serverProcess.stdout.setEncoding("utf8");
  serverProcess.stderr.setEncoding("utf8");

  serverProcess.stdout.on("data", (chunk) => {
    serverOutput += chunk;
  });

  serverProcess.stderr.on("data", (chunk) => {
    serverOutput += chunk;
  });

  await waitForServer();
});

after(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  const exited = once(serverProcess, "exit");
  serverProcess.kill("SIGTERM");

  try {
    await Promise.race([
      exited,
      delay(5000).then(() => {
        if (serverProcess.exitCode === null) {
          serverProcess.kill("SIGKILL");
        }
      }),
    ]);
  } catch {
    // The process may already have exited during cleanup.
  }
});

test("property search rejects invalid filters with HTTP 400", async () => {
  const response = await fetch(
    `${baseUrl}/api/properties?pinCode=123&bhk=2`,
  );

  assert.equal(response.status, 400);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/json/i,
  );
  assert.match(
    response.headers.get("cache-control") ?? "",
    /no-store/i,
  );

  const body = await response.json();
  assert.equal(body.error, "Invalid property search parameters");
});

test("property search rejects repeated filters with HTTP 400", async () => {
  const response = await fetch(
    `${baseUrl}/api/properties?bhk=2&bhk=3`,
  );

  assert.equal(response.status, 400);
  assert.match(
    response.headers.get("cache-control") ?? "",
    /no-store/i,
  );

  const body = await response.json();
  assert.equal(body.error, "Invalid property search parameters");
});

test("property search returns a safe HTTP 503 when its test database is unavailable", async () => {
  const response = await fetch(
    `${baseUrl}/api/properties?listingType=sale`,
  );

  assert.equal(response.status, 503);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/json/i,
  );
  assert.match(
    response.headers.get("cache-control") ?? "",
    /no-store/i,
  );

  const body = await response.json();
  assert.deepEqual(body, {
    error: "Property search is temporarily unavailable",
  });
  assert.doesNotMatch(
    JSON.stringify(body),
    /postgresql:\/\/|127\.0\.0\.1|casaora_test|password|ECONNREFUSED/i,
  );
});

test("homepage returns HTTP 200", async () => {
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  await response.arrayBuffer();
});

test("known property returns HTTP 200", async () => {
  const response = await fetch(
    `${baseUrl}/properties/mock-001`,
  );

  assert.equal(response.status, 200);

  const html = await response.text();

  assert.match(html, /A considered family home/);
});

test("unknown property returns a non-cacheable HTTP 404", async () => {
  const response = await fetch(
    `${baseUrl}/properties/day18-unknown-property`,
  );

  assert.equal(response.status, 404);
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/html/i,
  );
  assert.match(
    response.headers.get("cache-control") ?? "",
    /no-store/i,
  );
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex",
  );

  const html = await response.text();

  assert.match(html, /We couldn't find that property/);
});

test("repeated requests for an unknown property remain HTTP 404", async () => {
  const path = "/properties/day18-repeat-unknown";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`);

    assert.equal(
      response.status,
      404,
      `Request ${attempt} should return HTTP 404`,
    );

    assert.match(
      response.headers.get("cache-control") ?? "",
      /no-store/i,
    );

    await response.arrayBuffer();
  }
});

test("percent-encoded known property ID remains accessible", async () => {
  const response = await fetch(
    `${baseUrl}/properties/mock%2D001`,
  );

  assert.equal(response.status, 200);
  await response.arrayBuffer();
});

test("malformed percent-encoded property ID does not return HTTP 200", async () => {
  const response = await fetch(
    `${baseUrl}/properties/%E0%A4%A`,
  );

  assert.equal(response.status, 404);
  await response.arrayBuffer();
});

test("nested property routes are not served as known properties", async () => {
  const response = await fetch(
    `${baseUrl}/properties/mock-001/unexpected`,
  );

  assert.equal(response.status, 404);

  const html = await response.text();

  assert.doesNotMatch(
    html,
    /This address does not match a property in the current CASAORA development preview/,
  );
});

test("unrelated missing routes are not given the property error page", async () => {
  const response = await fetch(
    `${baseUrl}/day18-route-that-does-not-exist`,
  );

  assert.equal(response.status, 404);

  const html = await response.text();

  assert.doesNotMatch(
    html,
    /This address does not match a property in the current CASAORA development preview/,
  );
});
