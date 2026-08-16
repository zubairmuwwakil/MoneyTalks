import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Cron handlers authenticate their bearer token with cronAuth; Clerk sessions
// are intentionally unavailable to Vercel Cron.
const isPublicRoute = createRouteMatcher(["/", "/login(.*)", "/api/health", "/api/cron(.*)"]);
const isApiRoute = createRouteMatcher(["/api(.*)"]);

export const proxy = clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

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
