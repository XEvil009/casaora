"use client";

import Link from "next/link";
import { useState } from "react";

const navigationLinks = [
  { href: "/#discover", label: "Explore homes" },
  { href: "/#broker", label: "For brokers" },
  { href: "/#how-it-works", label: "How it works" },
];

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="site-header">
      <div className="container nav-shell">
        <Link
          className="brand"
          href="/"
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
        </Link>

        <nav
          className={`main-nav${menuOpen ? " is-open" : ""}`}
          id="primary-navigation"
          aria-label="Main navigation"
        >
          {navigationLinks.map((link) => (
            <Link
              href={link.href}
              key={link.href}
              onClick={closeMenu}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Link
          className="button button-dark nav-cta"
          href="/#get-started"
          onClick={closeMenu}
        >
          Get started <span aria-hidden="true">↗</span>
        </Link>

        <button
          className="menu-toggle"
          type="button"
          aria-controls="primary-navigation"
          aria-expanded={menuOpen}
          aria-label="Navigation menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
          <span>{menuOpen ? "Close" : "Menu"}</span>
        </button>
      </div>
    </header>
  );
}
