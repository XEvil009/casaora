"use client";

import { useMemo, useState } from "react";
import { mockProperties } from "@/data/mock-properties";
import PropertyCard from "@/components/property-card";
import {
  filterProperties,
  getPropertyLocalities,
} from "@/lib/property-filters";
import type {
  PropertyFilters,
  PropertyListingType,
} from "@/types/property";

const initialFilters: PropertyFilters = {
  listingType: "all",
  locality: "all",
  pinCode: "",
  bhk: "all",
  maxBudget: null,
};

const localities = getPropertyLocalities(mockProperties);

export default function PropertyDiscovery() {
  const [filters, setFilters] =
    useState<PropertyFilters>(initialFilters);
  const [budgetInput, setBudgetInput] = useState("");
  const parsedBudget = Number(budgetInput);
  const budgetError =
    budgetInput !== "" &&
    (!Number.isFinite(parsedBudget) || parsedBudget <= 0);

  const filteredProperties = useMemo(
    () => filterProperties(mockProperties, filters),
    [filters],
  );

  const activeFilterCount = [
    filters.listingType !== "all",
    filters.locality !== "all",
    /^\d{6}$/.test(filters.pinCode),
    filters.bhk !== "all",
    filters.maxBudget !== null,
  ].filter(Boolean).length;

  const hasActiveFilters =
    activeFilterCount > 0 ||
    filters.pinCode !== "" ||
    budgetInput !== "";

  function resetFilters() {
    setFilters({ ...initialFilters });
    setBudgetInput("");
  }

  const budgetHint =
    filters.listingType === "sale"
      ? "Compared with the total purchase price."
      : filters.listingType === "rent"
        ? "Compared with the monthly rent."
        : "Compared separately with sale prices and monthly rents.";

  return (
    <div className="discovery">
      <div className="discovery-notice" role="note">
        <strong>Development preview</strong>
        <span>
          All six listings are fictional sample data, not
          verified properties or live offers.
        </span>
      </div>

      <form
        className="property-filters"
        onSubmit={(event) => event.preventDefault()}
        aria-label="Property search filters"
      >
        <div className="filter-field">
          <label htmlFor="listing-type">Looking to</label>
          <select
            id="listing-type"
            value={filters.listingType}
            onChange={(event) => {
              const value = event.target.value;

              if (
                value === "all" ||
                value === "sale" ||
                value === "rent"
              ) {
                setFilters((current) => ({
                  ...current,
                  listingType: value as
                    | "all"
                    | PropertyListingType,
                }));
              }
            }}
          >
            <option value="all">Buy or rent</option>
            <option value="sale">Buy</option>
            <option value="rent">Rent</option>
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="property-locality">Locality</label>
          <select
            id="property-locality"
            value={filters.locality}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                locality: event.target.value,
              }))
            }
          >
            <option value="all">All localities</option>
            {localities.map((locality) => (
              <option key={locality} value={locality}>
                {locality}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="property-pin-code">PIN code</label>
          <input
            id="property-pin-code"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            pattern="[0-9]{6}"
            placeholder="e.g. 700156"
            aria-describedby="property-pin-code-hint"
            value={filters.pinCode}
            onChange={(event) => {
              const value = event.target.value
                .replace(/\D/g, "")
                .slice(0, 6);

              setFilters((current) => ({
                ...current,
                pinCode: value,
              }));
            }}
          />
          <span
            className="filter-hint"
            id="property-pin-code-hint"
          >
            Enter all 6 digits to filter by PIN code.
          </span>
        </div>

        <div className="filter-field">
          <label htmlFor="property-bhk">Bedrooms</label>
          <select
            id="property-bhk"
            value={filters.bhk}
            onChange={(event) => {
              const value = event.target.value;

              setFilters((current) => ({
                ...current,
                bhk: value === "all" ? "all" : Number(value),
              }));
            }}
          >
            <option value="all">Any BHK</option>
            <option value="1">1 BHK</option>
            <option value="2">2 BHK</option>
            <option value="3">3 BHK</option>
            <option value="4">4 BHK</option>
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="property-budget">
            Maximum budget (₹)
          </label>
          <input
            id="property-budget"
            type="number"
            min="1"
            step="1000"
            inputMode="numeric"
            autoComplete="off"
            placeholder="No limit"
            aria-invalid={budgetError}
            aria-describedby="property-budget-hint"
            value={budgetInput}
            onChange={(event) => {
              const rawValue = event.target.value;
              const parsedValue = Number(rawValue);

              setBudgetInput(rawValue);
              setFilters((current) => ({
                ...current,
                maxBudget:
                  rawValue !== "" &&
                  Number.isFinite(parsedValue) &&
                  parsedValue > 0
                    ? parsedValue
                    : null,
              }));
            }}
          />
          <span
            className={budgetError ? "filter-hint filter-hint-error" : "filter-hint"}
            id="property-budget-hint"
            aria-live="polite"
          >
            {budgetError
              ? "Enter a budget greater than ₹0, or clear the field to remove the limit."
              : budgetHint}
          </span>
        </div>

        <div className="filter-actions">
          <button
            className="button button-dark filter-reset"
            type="button"
            onClick={resetFilters}
            disabled={!hasActiveFilters}
          >
            {hasActiveFilters ? "Reset filters" : "No filters applied"}
          </button>

          <p className="active-filter-count">
            {filters.pinCode !== "" &&
            !/^\d{6}$/.test(filters.pinCode)
              ? "Enter 6 digits to apply the PIN filter"
              : budgetError
                ? "Correct the budget or clear it to remove the limit"
                : activeFilterCount === 0
                  ? "Showing all sample listings"
                  : `${activeFilterCount} ${
                      activeFilterCount === 1 ? "filter" : "filters"
                    } applied`}
          </p>
        </div>
      </form>

      <div className="discovery-results-heading">
        <h3>Properties to explore</h3>
        <p role="status" aria-live="polite" aria-atomic="true">
          {filteredProperties.length}{" "}
          {filteredProperties.length === 1
            ? "sample listing"
            : "sample listings"}{" "}
          found
        </p>
      </div>

      {filteredProperties.length > 0 ? (
        <div className="property-grid">
          {filteredProperties.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
            />
          ))}
        </div>
      ) : (
        <div className="discovery-empty" role="status">
          <h3>No sample properties match those filters</h3>
          <p>
            Try increasing your budget, choosing another locality,
            or selecting a different bedroom count.
          </p>
          <button
            className="button button-light"
            type="button"
            onClick={resetFilters}
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
