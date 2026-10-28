import Link from "next/link";
import SiteHeader from "@/components/site-header";

export default function PropertyNotFound() {
  return (
    <main className="property-detail-page">
      <SiteHeader />

      <section
        className="container property-detail-container"
        aria-labelledby="property-not-found-title"
      >
        <div className="discovery-notice" role="note">
          <strong>Property unavailable</strong>
          <span>
            This address does not match a property in the
            current CASAORA development preview.
          </span>
        </div>

        <div className="discovery-empty">
          <p className="eyebrow">CASAORA PROPERTY DISCOVERY</p>

          <h1 id="property-not-found-title">
            We couldn&apos;t find that property
          </h1>

          <p>
            The listing may have an incorrect address or may
            no longer be available in this sample dataset.
          </p>

          <Link className="button button-dark" href="/#discover">
            Explore properties
          </Link>

          <p>
            <Link href="/">Return to the CASAORA homepage</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
