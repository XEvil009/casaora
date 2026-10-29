import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";

const HOST = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 30000;

let serverProcess;
let browserProcess;
let browserSocket;
let browserDirectory;
let baseUrl;
let debuggingPort;
let serverOutput = "";
let nextCommandId = 0;
const pendingCommands = new Map();

async function findAvailablePort() {
  const server = createServer();
  server.listen(0, HOST);
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;

  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  return port;
}

async function waitForHttp(url) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `Production server exited early.\n${serverOutput}`,
      );
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(2000),
      });

      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
      await response.arrayBuffer();
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new Error(
    `Server did not become ready: ${lastError}\n${serverOutput}`,
  );
}

async function waitForDebuggingEndpoint() {
  const url = `http://${HOST}:${debuggingPort}/json/version`;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error("Chromium exited before debugging was ready.");
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(1000),
      });

      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }

    await delay(200);
  }

  throw new Error(`Chromium debugging endpoint unavailable: ${lastError}`);
}

function sendCommand(method, params = {}) {
  assert.ok(browserSocket, "Browser WebSocket is not connected.");

  const id = ++nextCommandId;

  return new Promise((resolve, reject) => {
    pendingCommands.set(id, { resolve, reject });
    browserSocket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await sendCommand("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      "Browser evaluation failed.",
    );
  }

  return response.result?.value;
}

async function waitForCount(expected) {
  const deadline = Date.now() + 10000;
  let actual = "";

  while (Date.now() < deadline) {
    actual = await evaluate(
      `document.querySelector('[aria-atomic="true"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`,
    );

    if (actual === expected) return;

    await delay(100);
  }

  assert.equal(actual, expected, "Timed out waiting for listing count.");
}

async function setSelect(id, value) {
  const expression = `(() => {
    const element = document.querySelector(${JSON.stringify(id)});
    if (!element) throw new Error("Missing select: " + ${JSON.stringify(id)});
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return element.value;
  })()`;

  await evaluate(expression);
}

async function setInput(id, value) {
  const expression = `(() => {
    const element = document.querySelector(${JSON.stringify(id)});
    if (!element) throw new Error("Missing input: " + ${JSON.stringify(id)});
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, "value"
    ).set;
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return element.value;
  })()`;

  await evaluate(expression);
}

async function click(selector) {
  const expression = `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Missing element: " + ${JSON.stringify(selector)});
    element.click();
    return true;
  })()`;

  await evaluate(expression);
}

before(async () => {
  const serverPort = await findAvailablePort();
  debuggingPort = await findAvailablePort();
  baseUrl = `http://${HOST}:${serverPort}`;

  serverProcess = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      HOST,
      "--port",
      String(serverPort),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  serverProcess.stdout.setEncoding("utf8");
  serverProcess.stderr.setEncoding("utf8");
  serverProcess.stdout.on("data", (chunk) => { serverOutput += chunk; });
  serverProcess.stderr.on("data", (chunk) => { serverOutput += chunk; });

  await waitForHttp(`${baseUrl}/`);

  browserDirectory = await mkdtemp(join(tmpdir(), "casaora-browser-"));

  browserProcess = spawn(
    process.env.CHROMIUM_PATH || "chromium-browser",
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      `--remote-debugging-port=${debuggingPort}`,
      `--remote-debugging-address=${HOST}`,
      `--user-data-dir=${browserDirectory}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  await waitForDebuggingEndpoint();

  const targetResponse = await fetch(
    `http://${HOST}:${debuggingPort}/json/new?${encodeURIComponent(baseUrl)}`,
    { method: "PUT" },
  );

  assert.equal(targetResponse.ok, true, "Could not create Chromium page.");

  const target = await targetResponse.json();
  assert.ok(target.webSocketDebuggerUrl, "Chromium returned no page WebSocket.");

  browserSocket = new WebSocket(target.webSocketDebuggerUrl);

  browserSocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);

    if (message.id === undefined) return;

    const pending = pendingCommands.get(message.id);
    if (!pending) return;

    pendingCommands.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result ?? {});
    }
  });

  browserSocket.addEventListener("close", () => {
    for (const pending of pendingCommands.values()) {
      pending.reject(new Error("Chromium debugging connection closed."));
    }
    pendingCommands.clear();
  });

  await new Promise((resolve, reject) => {
    browserSocket.addEventListener("open", resolve, { once: true });
    browserSocket.addEventListener("error", reject, { once: true });
  });

  await sendCommand("Page.enable");
  await sendCommand("Runtime.enable");
  await sendCommand("Page.navigate", { url: baseUrl });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = await evaluate(
      `Boolean(document.querySelector("#listing-type") && document.querySelector('[aria-atomic="true"]'))`,
    ).catch(() => false);

    if (ready) return;
    await delay(200);
  }

  throw new Error("Property discovery page did not become interactive.");
});

after(async () => {
  if (browserSocket && browserSocket.readyState < WebSocket.CLOSING) {
    browserSocket.close();
  }

  for (const child of [browserProcess, serverProcess]) {
    if (!child || child.exitCode !== null) continue;

    const exited = once(child, "exit").catch(() => {});
    child.kill("SIGTERM");

    await Promise.race([
      exited,
      delay(2500).then(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }),
    ]);
  }

  if (browserDirectory) {
    await rm(browserDirectory, { recursive: true, force: true });
  }
});

test("property discovery works in a real Chromium browser", async (t) => {
  await t.test("starts with six sample listings", async () => {
    await waitForCount("6 sample listings found");
  });

  await t.test("filters by New Town locality", async () => {
    await setSelect("#property-locality", "New Town");
    await waitForCount("2 sample listings found");
  });

  await t.test("reset restores all six listings", async () => {
    await click(".filter-reset");
    await waitForCount("6 sample listings found");
  });

  await t.test("filters visible cards by BHK", async () => {
    await click(".filter-reset");
    await setSelect("#property-bhk", "2");
    await waitForCount("2 sample listings found");

    const cardDetails = await evaluate(`Array.from(
      document.querySelectorAll(".property-card")
    ).map((card) =>
      card.querySelector(".property-details")?.textContent?.trim() ?? ""
    )`);

    assert.equal(cardDetails.length, 2);
    assert.ok(
      cardDetails.every((details) => details.startsWith("2 BHK")),
      "Every visible card should match the selected 2-BHK filter.",
    );
  });

  await t.test("combines rent and BHK filters", async () => {
    await click(".filter-reset");
    await setSelect("#listing-type", "rent");
    await setSelect("#property-bhk", "2");
    await waitForCount("2 sample listings found");

    const visibleCards = await evaluate(`Array.from(
      document.querySelectorAll(".property-card")
    ).map((card) => ({
      details: card.querySelector(".property-details")?.textContent?.trim() ?? "",
      type: card.querySelector(".property-type")?.textContent?.trim() ?? "",
    }))`);

    assert.equal(visibleCards.length, 2);
    assert.ok(
      visibleCards.every(
        (card) =>
          card.details.startsWith("2 BHK") &&
          card.type === "FOR RENT",
      ),
      "Every visible card should be a 2-BHK rental.",
    );

    await click(".filter-reset");
    await waitForCount("6 sample listings found");
  });

  await t.test("combines rent and maximum budget filters", async () => {
    await setSelect("#listing-type", "rent");
    await setInput("#property-budget", "20000");
    await waitForCount("1 sample listing found");
  });

  await t.test("clears a previously valid budget when the new budget is invalid", async () => {
    await click(".filter-reset");
    await setSelect("#listing-type", "rent");
    await setInput("#property-budget", "20000");
    await waitForCount("1 sample listing found");

    await setInput("#property-budget", "0");
    await waitForCount("3 sample listings found");

    const invalidBudget = await evaluate(
      `document.querySelector("#property-budget")?.getAttribute("aria-invalid") === "true"`,
    );
    assert.equal(
      invalidBudget,
      true,
      "Invalid budget should be exposed to assistive technology.",
    );
  });

  await t.test("reset clears every filter and invalid budget state", async () => {
    await click(".filter-reset");

    await setSelect("#listing-type", "rent");
    await setSelect("#property-locality", "New Town");
    await setInput("#property-pin-code", "700156");
    await setSelect("#property-bhk", "2");
    await setInput("#property-budget", "30000");

    await waitForCount("1 sample listing found");

    await setInput("#property-budget", "0");

    const invalidBeforeReset = await evaluate(
      `document.querySelector("#property-budget")?.getAttribute("aria-invalid") === "true"`,
    );
    assert.equal(
      invalidBeforeReset,
      true,
      "The zero budget should expose the invalid state before reset.",
    );

    await click(".filter-reset");
    await waitForCount("6 sample listings found");

    const resetState = await evaluate(`(() => {
      const value = (selector) =>
        document.querySelector(selector)?.value ?? null;
      const budget = document.querySelector("#property-budget");
      const reset = document.querySelector(".filter-reset");

      return {
        listingType: value("#listing-type"),
        locality: value("#property-locality"),
        pinCode: value("#property-pin-code"),
        bhk: value("#property-bhk"),
        budget: value("#property-budget"),
        budgetInvalid: budget?.getAttribute("aria-invalid"),
        resetDisabled: reset?.disabled,
        resetText: reset?.textContent?.trim(),
      };
    })()`);

    assert.deepEqual(resetState, {
      listingType: "all",
      locality: "all",
      pinCode: "",
      bhk: "all",
      budget: "",
      budgetInvalid: "false",
      resetDisabled: true,
      resetText: "No filters applied",
    });
  });

  await t.test("normalizes PIN input to six ASCII digits", async () => {
    await click(".filter-reset");

    await setInput("#property-pin-code", "70a0156");
    await waitForCount("2 sample listings found");

    const normalizedPin = await evaluate(
      'document.querySelector("#property-pin-code")?.value ?? null',
    );

    assert.equal(
      normalizedPin,
      "700156",
      "PIN input should remove non-digits and limit the value to six digits.",
    );
  });

  await t.test("shows empty state and clears an unmatched PIN", async () => {
    await click(".filter-reset");
    await waitForCount("6 sample listings found");

    await setInput("#property-pin-code", "999999");
    await waitForCount("0 sample listings found");

    const emptyState = await evaluate(
      `Boolean(document.querySelector(".discovery-empty"))`,
    );
    assert.equal(emptyState, true, "Empty-state message should be visible.");

    await click(".discovery-empty button");
    await waitForCount("6 sample listings found");
  });
});


// Day 26: mobile navigation and responsive browser regression tests.

async function setViewport(width, height = 844) {
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
}

async function waitForExpanded(expected) {
  const deadline = Date.now() + 2000;
  let actual = null;

  while (Date.now() < deadline) {
    actual = await evaluate(`document.querySelector(".menu-toggle")?.getAttribute("aria-expanded") ?? null`);
    if (actual === expected) return actual;
    await delay(50);
  }

  assert.equal(actual, expected, "Timed out waiting for mobile menu state.");
  return actual;
}

test("mobile navigation and narrow viewports work in Chromium", async () => {
  try {
    await setViewport(390);

    const initialState = await evaluate(`(() => {
      const toggle = document.querySelector(".menu-toggle");
      const nav = document.querySelector("#primary-navigation");

      return {
        toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
        expanded: toggle?.getAttribute("aria-expanded") ?? null,
        navDisplay: nav ? getComputedStyle(nav).display : null,
        viewportWidth: window.innerWidth,
      };
    })()`);

    assert.equal(initialState.toggleDisplay, "flex");
    assert.equal(initialState.expanded, "false");
    assert.equal(initialState.navDisplay, "none");

    await click(".menu-toggle");

    await waitForExpanded("true");

    const openedState = await evaluate(`(() => {
      const toggle = document.querySelector(".menu-toggle");
      const nav = document.querySelector("#primary-navigation");

      return {
        expanded: toggle?.getAttribute("aria-expanded") ?? null,
        navDisplay: nav ? getComputedStyle(nav).display : null,
      };
    })()`);

    assert.equal(openedState.expanded, "true");
    assert.equal(openedState.navDisplay, "flex");

    for (const width of [320, 360, 390, 430]) {
      await setViewport(width);

      const dimensions = await evaluate(`(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))()`);

      assert.ok(
        dimensions.document <= dimensions.viewport,
        `Horizontal document overflow at ${width}px: document=${dimensions.document}, viewport=${dimensions.viewport}`,
      );

      assert.ok(
        dimensions.body <= dimensions.viewport,
        `Horizontal body overflow at ${width}px: body=${dimensions.body}, viewport=${dimensions.viewport}`,
      );
    }

    await setViewport(390);

    await click('a[href="/#discover"]');

    const navigationDeadline = Date.now() + 3000;
    let closedState = null;

    while (Date.now() < navigationDeadline) {
      closedState = await evaluate(`(() => {
        const toggle = document.querySelector(".menu-toggle");
        const nav = document.querySelector("#primary-navigation");

        return {
          expanded: toggle?.getAttribute("aria-expanded") ?? null,
          navDisplay: nav ? getComputedStyle(nav).display : null,
          hash: window.location.hash,
          pathname: window.location.pathname,
        };
      })()`);

      if (
        closedState.expanded === "false" &&
        closedState.navDisplay === "none" &&
        closedState.hash === "#discover"
      ) {
        break;
      }

      await delay(50);
    }

    assert.equal(closedState?.expanded, "false");
    assert.equal(closedState?.navDisplay, "none");
    assert.equal(closedState?.hash, "#discover");
  } finally {
    await sendCommand("Emulation.clearDeviceMetricsOverride").catch(() => {});
  }
});
