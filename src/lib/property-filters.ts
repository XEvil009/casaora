import type {
  Property,
  PropertyFilters,
} from "@/types/property";

export function filterProperties(
  properties: readonly Property[],
  filters: PropertyFilters,
): Property[] {
  const maxBudget = filters.maxBudget;

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
      filters.locality !== "all" &&
      property.locality !== filters.locality
    ) {
      return false;
    }

    if (
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
