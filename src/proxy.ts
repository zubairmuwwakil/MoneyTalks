import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
  "/api/health",
  "/api/cron(.*)",
  "/waitlist",
  "/api/waitlist",
]);
// This is not public: POST /api/v1/wallet-events independently requires an
// installation-scoped token which is hashed at rest. The Wallet Shortcut cannot
// hold a Clerk browser session, so Clerk must not intercept this one route.
const isInstallationTokenRoute = createRouteMatcher(["/api/v1/wallet-events"]);
const isApiRoute = createRouteMatcher(["/api(.*)"]);

export const proxy = clerkMiddleware(async (auth, req) => {
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
