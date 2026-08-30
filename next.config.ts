import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // A stable deployment id lets multiple Next.js instances coordinate cache
  // invalidation and server-action encryption during rolling deploys.
  deploymentId: process.env.DEPLOYMENT_VERSION || undefined,
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

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  disableLogger: true,
});
