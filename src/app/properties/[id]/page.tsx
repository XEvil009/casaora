import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/site-header";
import { mockProperties } from "@/data/mock-properties";
import { getPropertyById } from "@/lib/property-lookup";
import {
  formatPropertyPrice,
  getPropertyPriceContext,
} from "@/lib/property-display";


export function generateStaticParams() {
  return mockProperties.map(({ id }) => ({ id }));
}

interface PropertyDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PropertyDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const property = getPropertyById(mockProperties, id);

  if (!property) {
    return { title: "Property not found | CASAORA" };
  }

  return {
    title: `${property.title} | CASAORA`,
    description:
      `${property.bhk} BHK fictional sample property in ` +
      `${property.locality}, Kolkata. Development preview only.`,
  };
}

export default async function PropertyDetailPage({
  params,
}: PropertyDetailPageProps) {
  const { id } = await params;
  const property = getPropertyById(mockProperties, id);

  if (!property) {
    notFound();
  }

  const price = formatPropertyPrice(property.priceInRupees);
  const priceContext = getPropertyPriceContext(property.listingType);

  return (
    <main className="property-detail-page">
      <SiteHeader />

      <div className="container property-detail-container">
        <Link className="property-back-link" href="/#discover">
          <span aria-hidden="true">←</span> Back to property discovery
        </Link>

        <div className="discovery-notice" role="note">
          <strong>Development preview</strong>
          <span>
            This is fictional sample data, not a verified property,
            confirmed availability, or live offer.
          </span>
        </div>

        <article className="property-detail">
          <div
            className={`property-detail-art property-art ${property.artClass}`}
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

          <div className="property-detail-content">
            <span className="eyebrow">
              {property.listingType === "sale"
                ? "PROPERTY FOR SALE"
                : "PROPERTY FOR RENT"}
            </span>

            <h1>{property.title}</h1>

            <p className="property-detail-location">
              {property.locality}, Kolkata, West Bengal
            </p>

            <p className="property-detail-price">{price}</p>
            <p className="property-price-context">
              {priceContext}
              {property.listingType === "rent" ? " · per month" : ""}
            </p>

            <div className="property-detail-facts">
              <div>
                <span>Bedrooms</span>
                <strong>{property.bhk} BHK</strong>
              </div>

              <div>
                <span>Area</span>
                <strong>
                  {property.areaSqFt.toLocaleString("en-IN")} sq. ft.
                </strong>
              </div>

              <div>
                <span>PIN code</span>
                <strong>{property.pinCode}</strong>
              </div>

              <div>
                <span>Locality</span>
                <strong>{property.locality}</strong>
              </div>
            </div>

            <p className="property-detail-disclaimer">
              Illustrative development content only. Property verification,
              broker contacts, enquiries, and live transaction services
              are not available yet.
            </p>

            <Link className="button button-dark" href="/#discover">
              Explore more properties
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </article>
      </div>
    </main>
  );
}
