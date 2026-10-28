export type PropertyListingType = "sale" | "rent";

export interface Property {
  id: string;
  title: string;
  listingType: PropertyListingType;
  locality: string;
  pinCode: string;
  bhk: number;
  areaSqFt: number;
  priceInRupees: number;
  initials: string;
  artClass: string;
}

export interface PropertyFilters {
  listingType: "all" | PropertyListingType;
  locality: string;
  pinCode: string;
  bhk: "all" | number;
  maxBudget: number | null;
}
