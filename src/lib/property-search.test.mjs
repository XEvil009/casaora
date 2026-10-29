import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPropertySearchQuery,
  parsePropertySearchParams,
} from "./property-search.ts";

test("uses safe defaults when no filters are supplied", () => {
  assert.deepEqual(
    parsePropertySearchParams(new URLSearchParams()),
    {
      limit: 20,
      offset: 0,
    },
  );
});

test("parses valid property search filters", () => {
  assert.deepEqual(
    parsePropertySearchParams(
      new URLSearchParams(
        "listingType=sale&locality=Salt%20Lake&pinCode=700091&bhk=2&maxBudget=8000000&limit=10&offset=5",
      ),
    ),
    {
      listingType: "sale",
      locality: "Salt Lake",
      pinCode: "700091",
      bhk: 2,
      maxBudget: 8000000,
      limit: 10,
      offset: 5,
    },
  );
});

test("trims locality input", () => {
  assert.equal(
    parsePropertySearchParams(
      new URLSearchParams("locality=%20Salt%20Lake%20"),
    ).locality,
    "Salt Lake",
  );
});

test("rejects an unsupported listing type", () => {
  assert.throws(
    () =>
      parsePropertySearchParams(
        new URLSearchParams("listingType=lease"),
      ),
  );
});

test("rejects malformed PIN codes", () => {
  for (const pinCode of ["7", "70015", "70015x", "1234567"]) {
    assert.throws(() =>
      parsePropertySearchParams(
        new URLSearchParams(`pinCode=${pinCode}`),
      ),
    );
  }
});

test("rejects invalid BHK values", () => {
  for (const bhk of ["0", "-1", "2.5", "21", "abc"]) {
    assert.throws(() =>
      parsePropertySearchParams(
        new URLSearchParams(`bhk=${bhk}`),
      ),
    );
  }
});

test("rejects invalid budget values", () => {
  for (const maxBudget of ["0", "-1", "Infinity", "abc"]) {
    assert.throws(() =>
      parsePropertySearchParams(
        new URLSearchParams(`maxBudget=${maxBudget}`),
      ),
    );
  }
});

test("rejects invalid pagination values", () => {
  for (const params of [
    "limit=0",
    "limit=101",
    "limit=2.5",
    "offset=-1",
    "offset=1000001",
  ]) {
    assert.throws(() =>
      parsePropertySearchParams(new URLSearchParams(params)),
    );
  }
});

test("rejects unknown query parameters", () => {
  assert.throws(() =>
    parsePropertySearchParams(
      new URLSearchParams("admin=true"),
    ),
  );
});

test("rejects repeated query parameters instead of silently choosing the last value", () => {
  for (const params of [
    "bhk=2&bhk=3",
    "listingType=sale&listingType=rent",
    "limit=10&limit=20",
  ]) {
    assert.throws(
      () => parsePropertySearchParams(new URLSearchParams(params)),
      /Duplicate query parameters are not allowed/,
    );
  }
});

test("query selects only published listings and joins canonical properties", () => {
  const filters = parsePropertySearchParams(
    new URLSearchParams(),
  );
  const query = buildPropertySearchQuery(filters);

  assert.match(query.text, /pl\.status = 'published'/);
  assert.match(
    query.text,
    /INNER JOIN properties AS p\s+ON p\.id = pl\.property_id/,
  );
  assert.match(query.text, /ORDER BY pl\.created_at DESC, pl\.id ASC/);
  assert.match(query.text, /LIMIT \$1/);
  assert.match(query.text, /OFFSET \$2/);
  assert.deepEqual(query.values, [20, 0]);
});

test("builds parameterized SQL for all supported filters", () => {
  const filters = parsePropertySearchParams(
    new URLSearchParams(
      "listingType=rent&locality=Salt%20Lake&pinCode=700091&bhk=3&maxBudget=50000&limit=15&offset=30",
    ),
  );
  const query = buildPropertySearchQuery(filters);

  assert.deepEqual(query.values, [
    "rent",
    "Salt Lake",
    "700091",
    3,
    50000,
    15,
    30,
  ]);

  for (let placeholder = 1; placeholder <= 7; placeholder += 1) {
    assert.ok(
      query.text.includes(`$${placeholder}`),
      `Expected SQL placeholder $${placeholder}`,
    );
  }

  assert.match(query.text, /pl\.listing_type = \$1/);
  assert.match(query.text, /p\.locality = \$2/);
  assert.match(query.text, /p\.pin_code = \$3/);
  assert.match(query.text, /p\.bhk = \$4/);
  assert.match(query.text, /pl\.price_in_rupees <= \$5/);
});

test("keeps SQL injection payloads in bound values", () => {
  const payload = "Salt Lake' OR 1=1; DROP TABLE properties; --";
  const query = buildPropertySearchQuery({
    ...parsePropertySearchParams(new URLSearchParams()),
    locality: payload,
  });

  assert.ok(query.values.includes(payload));
  assert.ok(!query.text.includes(payload));
  assert.match(query.text, /p\.locality = \$1/);
});

test("preserves price values as database text in the selected columns", () => {
  const query = buildPropertySearchQuery(
    parsePropertySearchParams(new URLSearchParams()),
  );

  assert.match(
    query.text,
    /pl\.price_in_rupees::text AS "priceInRupees"/,
  );
});
