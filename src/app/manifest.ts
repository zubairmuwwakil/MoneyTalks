import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Inunity — Personal Finance Command Center",
    short_name: "Inunity",
    description:
      "Personal finance command center for multi-currency tracking, ambient card copilot, cashflow forecasting, and tax compliance.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/favicon-dark.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    shortcuts: [
      {
        name: "Dashboard",
        url: "/",
        description: "Open financial command center",
      },
      {
        name: "Upload Receipt",
        url: "/receipts/upload",
        description: "Upload a purchase receipt",
      },
      {
        name: "Record Bill",
        url: "/bills/new",
        description: "Record an upcoming bill",
      },
      {
        name: "Money Finder",
        url: "/money-finder",
        description: "Check tax and benefit compliance rules",
      },
    ],
  };
}
