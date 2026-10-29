import { z } from "zod";

export const propertySearchSchema = z
  .object({
    listingType: z.enum(["sale", "rent"]).optional(),
    locality: z.string().trim().min(1).max(100).optional(),
    pinCode: z.string().regex(/^[0-9]{6}$/, {
      message: "PIN code must contain exactly six digits",
    }).optional(),
    bhk: z.coerce.number().int().min(1).max(20).optional(),
    maxBudget: z.coerce
      .number()
      .finite()
      .positive()
      .max(999999999999.99)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();

export type PropertySearchFilters = z.infer<
  typeof propertySearchSchema
>;

/**
 * Parse URL query parameters into validated search filters.
 *
 * Unknown parameters are rejected. Numeric inputs are validated
 * before they are used to construct the database query.
 */
export function parsePropertySearchParams(
  searchParams: URLSearchParams,
): PropertySearchFilters {
  const seen = new Set<string>();

  for (const key of searchParams.keys()) {
    if (seen.has(key)) {
      throw new Error("Duplicate query parameters are not allowed");
    }

    seen.add(key);
  }

  return propertySearchSchema.parse(
    Object.fromEntries(searchParams.entries()),
  );
}

/**
 * Values returned by PostgreSQL for a property-search result.
 *
 * priceInRupees remains a string to avoid silently losing precision
 * when PostgreSQL NUMERIC values are represented as JavaScript numbers.
 */
export interface PropertySearchRow {
  id: string;
  propertyId: string;
  title: string;
  listingType: "sale" | "rent";
  locality: string;
  pinCode: string;
  bhk: number | null;
  areaSqFt: number | null;
  priceInRupees: string;
  createdAt: Date | string;
}

export interface PropertySearchQuery {
  text: string;
  values: Array<string | number>;
}

/**
 * Construct a parameterized query for published property listings.
 *
 * All user-provided filter values are passed separately through
 * the PostgreSQL driver's values array, never interpolated into SQL.
 */
export function buildPropertySearchQuery(
  filters: PropertySearchFilters,
): PropertySearchQuery {
  const values: Array<string | number> = [];
  const conditions = ["pl.status = 'published'"];

  if (filters.listingType !== undefined) {
    values.push(filters.listingType);
    conditions.push(`pl.listing_type = $${values.length}`);
  }

  if (filters.locality !== undefined) {
    values.push(filters.locality);
    conditions.push(`p.locality = $${values.length}`);
  }

  if (filters.pinCode !== undefined) {
    values.push(filters.pinCode);
    conditions.push(`p.pin_code = $${values.length}`);
  }

  if (filters.bhk !== undefined) {
    values.push(filters.bhk);
    conditions.push(`p.bhk = $${values.length}`);
  }

  if (filters.maxBudget !== undefined) {
    values.push(filters.maxBudget);
    conditions.push(`pl.price_in_rupees <= $${values.length}`);
  }

  values.push(filters.limit);
  const limitPlaceholder = `$${values.length}`;

  values.push(filters.offset);
  const offsetPlaceholder = `$${values.length}`;

  return {
    text: `
      SELECT
        pl.id::text AS id,
        p.id::text AS "propertyId",
        pl.title AS title,
        pl.listing_type AS "listingType",
        p.locality AS locality,
        p.pin_code AS "pinCode",
        p.bhk AS bhk,
        p.area_sq_ft AS "areaSqFt",
        pl.price_in_rupees::text AS "priceInRupees",
        pl.created_at AS "createdAt"
      FROM property_listings AS pl
      INNER JOIN properties AS p
        ON p.id = pl.property_id
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY pl.created_at DESC, pl.id ASC
      LIMIT ${limitPlaceholder}
      OFFSET ${offsetPlaceholder}
    `,
    values,
  };
}
