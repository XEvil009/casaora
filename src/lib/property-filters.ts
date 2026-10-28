import type {
  Property,
  PropertyFilters,
} from "@/types/property";

export function filterProperties(
  properties: readonly Property[],
  filters: PropertyFilters,
): Property[] {
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
      filters.maxBudget !== null &&
      property.priceInRupees > filters.maxBudget
    ) {
      return false;
    }

    return true;
  });
}
