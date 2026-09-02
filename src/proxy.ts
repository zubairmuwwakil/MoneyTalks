import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { INSTALLATION_TOKEN_ROUTE_PATTERNS } from "@/lib/installationTokenRoutes";

// Cron handlers authenticate their bearer token with cronAuth; Clerk sessions
// are intentionally unavailable to Vercel Cron.
// /privacy must resolve signed out: App Store Connect requires a reachable
// privacy policy URL, and PickMe links to it from Settings on unauthenticated
// devices.
const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/signup(.*)",
  "/sign-up(.*)",
  "/privacy",
  "/terms",
  "/support",
  "/marketing(.*)",
  "/api/health(.*)",
  "/api/cron(.*)",
  "/waitlist",
  "/api/waitlist",
]);
// These are not public: each handler independently requires an installation-scoped
// token which is hashed at rest. Wallet Capture cannot hold a Clerk browser session,
// so Clerk must not intercept these routes before their token checks run.
const isInstallationTokenRoute = createRouteMatcher([...INSTALLATION_TOKEN_ROUTE_PATTERNS]);
const isApiRoute = createRouteMatcher(["/api(.*)"]);
// MCP has its own opaque OAuth bearer verification. A Clerk browser session
// must neither authorize it nor redirect OAuth clients to a browser login.
const isMcpRoute = createRouteMatcher(["/mcp", "/.well-known/oauth-protected-resource(.*)"]);

export const proxy = clerkMiddleware(async (auth, req) => {
  if (isMcpRoute(req)) return;
  if (isPublicRoute(req) || isInstallationTokenRoute(req)) return;

  if (isApiRoute(req)) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return;
  }

  await auth.protect({ unauthenticatedUrl: new URL("/login", req.url).toString() });
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
