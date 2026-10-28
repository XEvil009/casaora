"use client";

import { useState } from "react";

const navigationLinks = [
  { href: "#discover", label: "Explore homes" },
  { href: "#broker", label: "For brokers" },
  { href: "#how-it-works", label: "How it works" },
];

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="site-header">
      <div className="container nav-shell">
        <a
          className="brand"
          href="#home"
          aria-label="CASAORA home"
          onClick={closeMenu}
        >
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <span className="brand-copy">
            <span className="brand-name">CASAORA</span>
            <span className="brand-caption">
              PROPERTY. PEOPLE. POSSIBILITIES.
            </span>
          </span>
        </a>

        <nav
          className={`main-nav${menuOpen ? " is-open" : ""}`}
          id="primary-navigation"
          aria-label="Main navigation"
        >
          {navigationLinks.map((link) => (
            <a
              href={link.href}
              key={link.href}
              onClick={closeMenu}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <a
          className="button button-dark nav-cta"
          href="#get-started"
          onClick={closeMenu}
        >
          Get started <span aria-hidden="true">↗</span>
        </a>

        <button
          className="menu-toggle"
          type="button"
          aria-controls="primary-navigation"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
          <span>{menuOpen ? "Close" : "Menu"}</span>
        </button>
      </div>
    </header>
  );
}
