import type { PropertyListingType } from "@/types/property";

const indianRupee = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatPropertyPrice(priceInRupees: number): string {
  return indianRupee.format(priceInRupees);
}

export function getPropertyPriceContext(
  listingType: PropertyListingType,
): string {
  return listingType === "rent"
    ? "Monthly rent"
    : "Total purchase price";
}
