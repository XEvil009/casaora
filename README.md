# CASAORA

**One Property. One Network. Every Opportunity.**

CASAORA is a real-estate marketplace and broker collaboration platform
initially focused on Kolkata, West Bengal, India.

## Project status

Day 1 — Project Foundation.

The initial Next.js application has been created. The production build
succeeded using Webpack on Android/Termux.

## Technology stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- PostgreSQL as the authoritative data store
- Zod validation
- Vitest testing
- Playwright browser testing
- Git and GitHub
- Progressive Web App support

Leaflet and an OpenStreetMap-compatible data source are planned for
mapping. Payment and identity verification will initially use
replaceable simulated adapters.

## Development environment

- Android with Termux
- Node.js v24.22.1
- npm 11.21.1
- Next.js 16.4.3

## Getting started

From the project directory:

    npm run dev

Open http://127.0.0.1:3000 in a browser on the same device.

The development and production build scripts use Webpack for
compatibility with the current Android environment.

## Available commands

    npm run dev
    npm run lint
    npm run build
    npm run start

Run `npm run build` before starting the production server with
`npm run start`.

## User roles

- Broker
- Buyer or renter
- Administrator

## Planned capabilities

- Registration, login, profiles and role-based access
- Property listings, search and filters
- Canonical property records and duplicate detection
- Shared broker pools
- Versioned customer requirement queues
- Property-to-requirement matching
- Transactions and explicit broker attribution
- Simulated payments, commissions and auditable ledger
- Points, milestones and leaderboards
- Administrative dashboards, notifications and audit events
- Responsive, installable PWA

Business rules must be enforced by backend services and PostgreSQL,
not trusted to the browser.

## Development principles

- Follow the 30-day development plan.
- Preserve working functionality.
- Use controlled PostgreSQL migrations.
- Keep secrets out of source control.
- Test critical business rules.
- Never claim checks passed without evidence.
- Prefer free development tools and service tiers.

## Repository

GitHub profile: https://github.com/XEvil009/

The repository URL will be added after the project repository is
created or selected on GitHub.
