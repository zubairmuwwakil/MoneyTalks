import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // CSV uploads are capped at 5 MB in validation; leave multipart framing
    // headroom so legitimate statement uploads reach the shared parser.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
