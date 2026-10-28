import type { Property } from "@/types/property";

interface PropertyCardProps {
  property: Property;
}

const indianRupee = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function PropertyCard({
  property,
}: PropertyCardProps) {
  const price = indianRupee.format(property.priceInRupees);
  const priceSuffix =
    property.listingType === "rent" ? " / month" : "";

  return (
    <article className="property-card">
      <div className={`property-art ${property.artClass}`}>
        <span className="property-type">
          {property.listingType === "sale"
            ? "FOR SALE"
            : "FOR RENT"}
        </span>

        <span className="property-monogram" aria-hidden="true">
          {property.initials}
        </span>

        <span className="art-caption">
          FICTIONAL SAMPLE · KOLKATA
        </span>
      </div>

      <div className="property-content">
        <span className="property-location">
          <span aria-hidden="true">⌖</span>{" "}
          {property.locality}, Kolkata
        </span>

        <h3>{property.title}</h3>

        <p className="property-details">
          {property.bhk} BHK ·{" "}
          {property.areaSqFt.toLocaleString("en-IN")} sq. ft.
        </p>

        <p className="property-details property-pin">
          PIN code: {property.pinCode}
        </p>

        <div className="property-card-footer">
          <strong>
            {price}
            {priceSuffix}
          </strong>
          <span aria-hidden="true">↗</span>
        </div>
      </div>
    </article>
  );
}
