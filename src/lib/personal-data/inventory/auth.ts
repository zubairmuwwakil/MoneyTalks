import "server-only";

import type { NextRequest } from "next/server";

import { secretEquals } from "@/lib/security/secretCrypto";

function bearerToken(req: NextRequest): string | null {
  const authorization = req.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get("x-personal-data-api-key")?.trim() || null;
}

export function isAuthorizedPersonalDataRequest(req: NextRequest): boolean {
  const configured = process.env["PERSONAL_DATA_API_KEY"]?.trim();
  const supplied = bearerToken(req);
  if (!configured || !supplied) return false;
  return secretEquals(configured, supplied);
}
