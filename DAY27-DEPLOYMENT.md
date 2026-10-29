# CASAORA — Day 27 Deployment Notes

## Current application status

CASAORA currently provides a Next.js property-discovery development
preview with sample property data. Do not treat the preview as a
production marketplace with authentication, database persistence,
payments, or broker transaction processing.

## PWA

The App Router manifest is provided at `/manifest.webmanifest`.
The CASAORA SVG icon is available at `/casaora-icon.svg`.

A manifest is only one part of PWA readiness. Verify installation
in a supported browser over HTTPS and confirm icon compatibility on
the target device. Platform requirements may require PNG icons at
192x192 and 512x512 pixels. Offline caching is not enabled by this
change.

## Health check

GET `/api/health` returns a small JSON response with status, service,
and timestamp fields. It does not check a database or external
dependencies and must not be interpreted as a full dependency-health
check.

## Environment variables

Copy `.env.example` to `.env.local` for local development if needed.
Only put public, non-secret configuration in variables prefixed
with `NEXT_PUBLIC_`; their values can be included in browser bundles.

Never commit `.env.local`, production credentials, API tokens, or
private keys. Configure production values in the hosting provider's
environment-variable settings.

## Deployment

A suitable first deployment option is Vercel's Next.js integration.
Connect the GitHub repository, select the `main` branch, and review
the build and deployment logs. Confirm the provider's current free
plan, usage limits, and terms before relying on it.

A successful local build does not prove a remote deployment works.
Verify the deployed homepage, a known property, an unknown property,
the manifest, and `/api/health` over HTTPS.

Do not deploy secrets or enable broad offline caching as part of
this initial PWA step.
