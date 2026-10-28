import SiteHeader from "@/components/site-header";
import PropertyDiscovery from "@/components/property-discovery";
const audiences = [
  {
    number: "01",
    title: "For brokers",
    description:
      "Build your professional network, collaborate on shared properties, and connect customer requirements with suitable listings.",
    link: "#broker",
    action: "Explore broker network",
  },
  {
    number: "02",
    title: "For buyers & renters",
    description:
      "Discover homes across Kolkata and connect with property professionals who understand what you need.",
    link: "#discover",
    action: "Explore properties",
  },
  {
    number: "03",
    title: "For administrators",
    description:
      "The planned operations workspace will support platform oversight, reviews, and auditable workflows.",
    link: "#administrator",
    action: "Admin workspace — coming soon",
  },
];

export default function Home() {
  return (
    <main>
      <SiteHeader />

      <section className="hero" id="home">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" />
              A NEW WAY TO WORK IN REAL ESTATE
            </div>

            <h1>
              Property is local.
              <br />
              <span>Opportunity</span>
              <br />
              is shared.
            </h1>

            <p className="hero-description">
              One Property. One Network. Every Opportunity.
            </p>

            <p className="hero-support">
              Discover homes, connect with trusted property professionals, and
              build better opportunities across Kolkata — together.
            </p>

            <div className="hero-actions">
              <a className="button button-dark" href="#discover">
                Discover properties <span aria-hidden="true">↗</span>
              </a>
              <a className="button button-light" href="#broker">
                Join the broker network
              </a>
            </div>

            <div className="hero-note">
              <span className="note-symbol" aria-hidden="true">+</span>
              <span>Designed for a more connected real-estate community.</span>
            </div>
          </div>

          <div className="hero-visual" aria-label="Illustration of a modern home">
            <div className="visual-topline">
              <span>KOLKATA, WEST BENGAL</span>
              <span>22.57° N / 88.36° E</span>
            </div>

            <div className="architecture-scene" aria-hidden="true">
              <div className="sun-disc" />
              <div className="scene-hill scene-hill-back" />
              <div className="scene-hill scene-hill-front" />
              <div className="building building-back">
                <span className="building-window" />
                <span className="building-window" />
                <span className="building-window" />
                <span className="building-window" />
              </div>
              <div className="building building-main">
                <div className="building-roof" />
                <div className="building-facade">
                  <div className="facade-window" />
                  <div className="facade-window" />
                  <div className="facade-window" />
                  <div className="facade-window" />
                  <div className="facade-door" />
                </div>
              </div>
              <div className="plant plant-left"><span /></div>
              <div className="plant plant-right"><span /></div>
            </div>

            <div className="visual-bottomline">
              <div>
                <span className="visual-label">MORE THAN A LISTING</span>
                <strong>A network built around people.</strong>
              </div>
              <span className="visual-index">01 / 03</span>
            </div>

            <div className="floating-note">
              <span className="floating-icon" aria-hidden="true">↗</span>
              <span>
                <strong>Better together</strong>
                <small>One connected community</small>
              </span>
            </div>
          </div>
        </div>

        <div className="container hero-footer">
          <span>MADE FOR KOLKATA</span>
          <span>HOMES · PEOPLE · COLLABORATION</span>
          <a href="#discover">Scroll to explore <span aria-hidden="true">↓</span></a>
        </div>
      </section>

      <section className="principles-section" id="how-it-works">
        <div className="container principles-grid">
          <div className="section-intro">
            <span className="eyebrow">THE CASAORA APPROACH</span>
            <h2>A better property journey starts with a better connection.</h2>
          </div>

          <article className="principle">
            <span className="principle-number">01 / DISCOVER</span>
            <h3>Find the right fit</h3>
            <p>Explore property opportunities by location, budget, and needs.</p>
          </article>

          <article className="principle">
            <span className="principle-number">02 / CONNECT</span>
            <h3>Work as a network</h3>
            <p>Bring brokers and suitable opportunities closer together.</p>
          </article>

          <article className="principle">
            <span className="principle-number">03 / MOVE FORWARD</span>
            <h3>Build with clarity</h3>
            <p>Create a foundation for more transparent, organised workflows.</p>
          </article>
        </div>
      </section>

      <section className="discover-section" id="discover">
        <div className="container">
          <div className="section-heading-row">
            <div className="section-intro">
              <span className="eyebrow">EXPLORE KOLKATA</span>
              <h2>Every home has a story.</h2>
              <p>
                Discover sample property opportunities by location,
                budget, and the space you need.
              </p>
            </div>
            <span className="sample-label">FICTIONAL DEVELOPMENT DATA</span>
          </div>

          <PropertyDiscovery />
        </div>
      </section>

      <section className="audience-section" id="get-started">
        <div className="container">
          <div className="section-intro audience-heading">
            <span className="eyebrow">YOUR PLACE IN THE NETWORK</span>
            <h2>One platform. Different journeys.</h2>
            <p>Start with the experience that fits your role.</p>
          </div>

          <div className="audience-grid">
            {audiences.map((audience) => (
              <article
                className="audience-card"
                id={
                  audience.number === "01"
                    ? "broker"
                    : audience.number === "03"
                      ? "administrator"
                      : undefined
                }
                key={audience.number}
              >
                <span className="audience-number">{audience.number}</span>
                <h3>{audience.title}</h3>
                <p>{audience.description}</p>
                <a href={audience.link} className="text-link">
                  {audience.action} <span aria-hidden="true">↗</span>
                </a>
              </article>
            ))}
          </div>
          <p className="future-note">
            Account registration, login, role permissions, and live property
            services have not been implemented yet.
          </p>
        </div>
      </section>

      <section className="closing-section">
        <div className="container closing-content">
          <span className="eyebrow">THE FUTURE OF LOCAL REAL ESTATE</span>
          <h2>
            Good connections
            <br />
            make <span>great opportunities.</span>
          </h2>
          <p>
            CASAORA is being built for the people who make the property
            market work.
          </p>
          <a className="button button-gold" href="#get-started">
            Explore the CASAORA vision <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container footer-main">
          <a className="brand footer-brand" href="#home">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span className="brand-copy">
              <span className="brand-name">CASAORA</span>
              <span className="brand-caption">PROPERTY. PEOPLE. POSSIBILITIES.</span>
            </span>
          </a>
          <p>One Property. One Network. Every Opportunity.</p>
          <a href="#home" className="back-to-top">
            Back to top ↑
          </a>
        </div>
        <div className="container footer-legal">
          <span>© 2026 CASAORA · KOLKATA, INDIA</span>
          <span>A property network in development.</span>
        </div>
      </footer>
    </main>
  );
}
