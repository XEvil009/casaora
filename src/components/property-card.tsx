import Link from "next/link";
import type { Property } from "@/types/property";
import {
  formatPropertyPrice,
  getPropertyPriceContext,
} from "@/lib/property-display";

interface PropertyCardProps {
  property: Property;
}

export default function PropertyCard({
  property,
}: PropertyCardProps) {
  const price = formatPropertyPrice(property.priceInRupees);
  const priceContext = getPropertyPriceContext(property.listingType);
  const detailHref = `/properties/${property.id}`;

  return (
    <article className="property-card">
      <div
        className={`property-art ${property.artClass}`}
        role="img"
        aria-label={
          `Decorative fictional property illustration for ` +
          `${property.locality}, Kolkata`
        }
      >
        <span className="property-type">
          {property.listingType === "sale" ? "FOR SALE" : "FOR RENT"}
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
          <div className="property-price">
            <strong>{price}</strong>
            <span className="property-price-context">
              {priceContext}
              {property.listingType === "rent" ? " · per month" : ""}
            </span>
          </div>

          <Link
            className="property-card-mark"
            href={detailHref}
            aria-label={`View details for ${property.title}`}
          >
            <span aria-hidden="true">↗</span>
          </Link>
        </div>

        <Link className="property-detail-link" href={detailHref}>
          View property details
        </Link>
      </div>
    </article>
  );
}
