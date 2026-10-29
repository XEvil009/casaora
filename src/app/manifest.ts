import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CASAORA — One Property. One Network. Every Opportunity.",
    short_name: "CASAORA",
    description:
      "Discover property opportunities and build real-estate connections across Kolkata.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#26372b",
    lang: "en-IN",
    icons: [
      {
        src: "/casaora-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
