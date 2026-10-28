import test from "node:test";
import assert from "node:assert/strict";
import { mockProperties } from "../data/mock-properties.ts";
import {
  filterProperties,
  getPropertyLocalities,
} from "./property-filters.ts";

const allFilters = {
  listingType: "all",
  locality: "all",
  pinCode: "",
  bhk: "all",
  maxBudget: null,
};

test("returns all six properties without filters", () => {
  assert.equal(
    filterProperties(mockProperties, allFilters).length,
    6,
  );
});

test("filters properties for rent", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    listingType: "rent",
  });

  assert.equal(results.length, 3);
  assert.ok(results.every((property) => property.listingType === "rent"));
});

test("filters properties for sale", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    listingType: "sale",
  });

  assert.equal(results.length, 3);
  assert.ok(results.every((property) => property.listingType === "sale"));
});

test("filters by locality", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    locality: "New Town",
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((property) => property.locality === "New Town"));
});

test("filters by an exact six-digit PIN code", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    pinCode: "700156",
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((property) => property.pinCode === "700156"));
});

test("combines PIN code with locality and listing type", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    listingType: "rent",
    locality: "New Town",
    pinCode: "700156",
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "mock-004");
});

test("ignores incomplete or invalid PIN codes in the filter function", () => {
  for (const pinCode of ["7", "70015", "70015x", "1234567"]) {
    assert.deepEqual(
      filterProperties(mockProperties, {
        ...allFilters,
        pinCode,
      }),
      mockProperties,
    );
  }
});

test("filters by BHK", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    bhk: 2,
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((property) => property.bhk === 2));
});

test("uses an inclusive maximum budget", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    listingType: "rent",
    maxBudget: 24000,
  });

  assert.ok(results.length > 0);
  assert.ok(results.every((property) => property.priceInRupees <= 24000));
  assert.ok(results.some((property) => property.priceInRupees === 24000));
});

test("combines listing type, locality, BHK, and budget", () => {
  const results = filterProperties(mockProperties, {
    listingType: "rent",
    locality: "New Town",
    pinCode: "",
    bhk: 2,
    maxBudget: 30000,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "mock-004");
});

test("returns no results for impossible filters", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    locality: "New Town",
    bhk: 4,
    maxBudget: 1000,
  });

  assert.deepEqual(results, []);
});

test("does not mutate the original dataset", () => {
  const originalIds = mockProperties.map((property) => property.id);

  filterProperties(mockProperties, {
    ...allFilters,
    listingType: "sale",
  });

  assert.deepEqual(
    mockProperties.map((property) => property.id),
    originalIds,
  );
});

import {
  formatPropertyPrice,
  getPropertyPriceContext,
} from "./property-display.ts";

test("formats prices using Indian rupee grouping", () => {
  assert.equal(formatPropertyPrice(9200000), "₹92,00,000");
  assert.equal(formatPropertyPrice(24000), "₹24,000");
});

test("distinguishes purchase price from monthly rent", () => {
  assert.equal(
    getPropertyPriceContext("sale"),
    "Total purchase price",
  );

  assert.equal(
    getPropertyPriceContext("rent"),
    "Monthly rent",
  );
});

import { getPropertyById } from "./property-lookup.ts";

test("looks up a property by its stable ID", () => {
  const property = getPropertyById(mockProperties, "mock-001");

  assert.ok(property);
  assert.equal(property.id, "mock-001");
  assert.equal(property.locality, "New Town");
});

test("returns undefined for an unknown property ID", () => {
  assert.equal(
    getPropertyById(mockProperties, "does-not-exist"),
    undefined,
  );
});

test("does not mutate properties during lookup", () => {
  const originalIds = mockProperties.map((property) => property.id);

  getPropertyById(mockProperties, "mock-003");

  assert.deepEqual(
    mockProperties.map((property) => property.id),
    originalIds,
  );
});

test("ignores a zero maximum budget", () => {
  assert.deepEqual(
    filterProperties(mockProperties, {
      ...allFilters,
      maxBudget: 0,
    }),
    mockProperties,
  );
});

test("ignores a negative maximum budget", () => {
  assert.deepEqual(
    filterProperties(mockProperties, {
      ...allFilters,
      maxBudget: -1000,
    }),
    mockProperties,
  );
});

test("ignores a non-finite maximum budget", () => {
  for (const maxBudget of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.deepEqual(
      filterProperties(mockProperties, {
        ...allFilters,
        maxBudget,
      }),
      mockProperties,
    );
  }
});

test("still applies other filters when the budget is invalid", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    listingType: "rent",
    maxBudget: Number.NaN,
  });

  assert.equal(results.length, 3);
  assert.ok(
    results.every((property) => property.listingType === "rent"),
  );
});


test("returns unique localities in alphabetical order", () => {
  assert.deepEqual(
    getPropertyLocalities(mockProperties),
    ["New Town", "Rajarhat", "Salt Lake"],
  );
});

test("returns an empty locality list for no properties", () => {
  assert.deepEqual(getPropertyLocalities([]), []);
});


test("combines all five property filters", () => {
  const results = filterProperties(mockProperties, {
    listingType: "rent",
    locality: "New Town",
    pinCode: "700156",
    bhk: 2,
    maxBudget: 28000,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "mock-004");
});

test("keeps other filters effective with an incomplete PIN", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    listingType: "rent",
    pinCode: "70015",
  });

  assert.equal(results.length, 3);
  assert.ok(results.every((property) => property.listingType === "rent"));
});

test("trims whitespace around a valid PIN code", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    pinCode: " 700156 ",
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((property) => property.pinCode === "700156"));
});

test("ignores a budget supplied with the wrong runtime type", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    listingType: "rent",
    maxBudget: "28000",
  });

  assert.equal(results.length, 3);
  assert.ok(results.every((property) => property.listingType === "rent"));
});

test("ignores a locality that is not in the property dataset", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    locality: "Unknown locality",
  });

  assert.deepEqual(results, mockProperties);
});

test("ignores unsupported BHK filter values", () => {
  for (const bhk of [0, 5, -1, 2.5, Number.NaN, "2"]) {
    const results = filterProperties(mockProperties, {
      ...allFilters,
      bhk,
    });

    assert.deepEqual(results, mockProperties);
  }
});

test("still applies valid filters when locality is unsupported", () => {
  const results = filterProperties(mockProperties, {
    ...allFilters,
    listingType: "rent",
    locality: "Unknown locality",
  });

  assert.equal(results.length, 3);
  assert.ok(
    results.every((property) => property.listingType === "rent"),
  );
});
