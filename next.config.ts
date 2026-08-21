import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.r2.dev",
      },
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "**.inunity.ca",
      },
      {
        protocol: "https",
        hostname: "inunity.ca",
      },
      {
        protocol: "https",
        hostname: "assets.inunity.app",
      },
    ],
  },
  experimental: {
    // CSV uploads are capped at 5 MB in validation; leave multipart framing
    // headroom so legitimate statement uploads reach the shared parser.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
