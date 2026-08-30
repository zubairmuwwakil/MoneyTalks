//oauth routes 

//start connect

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUserId } from "@/lib/require-user";
import { oauthClient } from "@/lib/services/gmailClient";
import { generateOAuthState, OAUTH_STATE_COOKIE } from "@/lib/security/oauthState";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const oauth2 = oauthClient();
  const state = generateOAuthState();

  // SameSite=Lax (not Strict): Google's redirect back to /api/gmail/callback
  // is a top-level GET navigation, which Lax still sends the cookie on.
  (await cookies()).set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    // "select_account" as well as "consent": without the chooser Google reuses
    // whichever account the browser is already signed into, so an owner could
    // never actually reach a SECOND mailbox from this button.
    prompt: "consent select_account",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    state,
  });

  return NextResponse.redirect(url);
}
