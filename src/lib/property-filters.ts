import type {
  Property,
  PropertyFilters,
} from "@/types/property";

export function filterProperties(
  properties: readonly Property[],
  filters: PropertyFilters,
): Property[] {
  const maxBudget = filters.maxBudget;
  const pinCode = filters.pinCode.trim();
  const hasValidPinCode = /^\d{6}$/.test(pinCode);
  const validLocalities = new Set(getPropertyLocalities(properties));
  const hasValidLocality =
    filters.locality === "all" ||
    (typeof filters.locality === "string" &&
      validLocalities.has(filters.locality));
  const hasValidBhk =
    filters.bhk === "all" ||
    (typeof filters.bhk === "number" &&
      Number.isInteger(filters.bhk) &&
      filters.bhk >= 1 &&
      filters.bhk <= 4);

  const hasValidBudget =
    maxBudget !== null &&
    Number.isFinite(maxBudget) &&
    maxBudget > 0;

  return properties.filter((property) => {
    if (
      filters.listingType !== "all" &&
      property.listingType !== filters.listingType
    ) {
      return false;
    }

    if (
      hasValidLocality &&
      filters.locality !== "all" &&
      property.locality !== filters.locality
    ) {
      return false;
    }

    if (
      hasValidPinCode &&
      property.pinCode !== pinCode
    ) {
      return false;
    }

    if (
      hasValidBhk &&
      filters.bhk !== "all" &&
      property.bhk !== filters.bhk
    ) {
      return false;
    }

    if (
      hasValidBudget &&
      property.priceInRupees > maxBudget
    ) {
      return false;
    }

    return true;
  });
}

export function getPropertyLocalities(
  properties: readonly Property[],
): string[] {
  return [...new Set(
    properties.map((property) => property.locality),
  )].sort((a, b) => a.localeCompare(b));
}
