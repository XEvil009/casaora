import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const discovery = await readFile(
  new URL("../src/components/property-discovery.tsx", import.meta.url),
  "utf8",
);

const header = await readFile(
  new URL("../src/components/site-header.tsx", import.meta.url),
  "utf8",
);

const css = await readFile(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("property search form has an accessible name", () => {
  assert.match(
    discovery,
    /aria-label="Property search filters"/,
  );
});

test("all five filter controls have associated labels", () => {
  for (const id of [
    "listing-type",
    "property-locality",
    "property-pin-code",
    "property-bhk",
    "property-budget",
  ]) {
    assert.match(
      discovery,
      new RegExp(`<label htmlFor="${id}">`),
      `Missing label for ${id}`,
    );

    assert.match(
      discovery,
      new RegExp(`id="${id}"`),
      `Missing control with id ${id}`,
    );
  }
});

test("PIN input preserves six-digit and numeric-input constraints", () => {
  assert.match(discovery, /inputMode="numeric"/);
  assert.match(discovery, /autoComplete="postal-code"/);
  assert.ok(discovery.includes("maxLength={6}"));
  assert.match(discovery, /pattern="\[0-9\]\{6\}"/);
  assert.match(discovery, /\.replace\(\/\\D\/g, ""\)/);
  assert.match(discovery, /\.slice\(0, 6\)/);
});

test("budget validation is exposed to assistive technology", () => {
  assert.match(discovery, /aria-invalid={budgetError}/);
  assert.match(
    discovery,
    /aria-describedby="property-budget-hint"/,
  );
  assert.match(discovery, /aria-live="polite"/);
  assert.match(
    discovery,
    /parsedValue > 0\s*\?\s*parsedValue\s*:\s*null/,
  );
});

test("results announce their updated count", () => {
  assert.match(
    discovery,
    /role="status" aria-live="polite" aria-atomic="true"/,
  );
  assert.match(discovery, /filteredProperties\.length/);
});

test("filter reset is available and disabled when unnecessary", () => {
  assert.match(discovery, /onClick={resetFilters}/);
  assert.match(discovery, /disabled={!hasActiveFilters}/);
  assert.match(discovery, /Clear all filters/);
});

test("navigation exposes its controlled open state", () => {
  assert.match(header, /id="primary-navigation"/);
  assert.match(header, /aria-label="Main navigation"/);
  assert.match(header, /aria-controls="primary-navigation"/);
  assert.match(header, /aria-expanded={menuOpen}/);
  assert.match(
    header,
    /setMenuOpen\(\(open\) => !open\)/,
  );
  assert.match(header, /className={`main-nav\$\{menuOpen \? " is-open" : ""\}`}/);
});

test("navigation links close the mobile menu", () => {
  assert.match(
    header,
    /navigationLinks\.map\([\s\S]*?onClick={closeMenu}/,
  );
  assert.match(
    header,
    /className="button button-dark nav-cta"[\s\S]*?onClick={closeMenu}/,
  );
});

test("mobile navigation is hidden until opened", () => {
  assert.match(
    css,
    /@media \(max-width:\s*680px\)[\s\S]*?\.main-nav\s*\{[^}]*display:\s*none;/,
  );
  assert.match(
    css,
    /\.main-nav\.is-open\s*\{[^}]*display:\s*flex;/,
  );
});

test("keyboard focus indicators exist for interactive controls", () => {
  assert.match(css, /\.menu-toggle:focus-visible/);
  assert.match(css, /\.filter-field select:focus-visible/);
  assert.match(css, /\.filter-field input:focus-visible/);
  assert.match(css, /\.filter-reset:focus-visible/);
  assert.match(css, /a:focus-visible/);
});

test("reduced-motion preferences are respected", () => {
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /scroll-behavior:\s*auto\s*!important/);
});
