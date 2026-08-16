"use client";

import { Fingerprint, KeyRound } from "lucide-react";
import { signIn } from "next-auth/webauthn";

export function PasskeySignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("passkey")}
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border/80 bg-secondary px-4 text-xs font-semibold text-secondary-foreground shadow-2xs hover:bg-secondary/80 transition-colors cursor-pointer"
    >
      <Fingerprint className="size-4" />
      <span>Sign in with a passkey</span>
    </button>
  );
}

export function PasskeyRegisterButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("passkey", { action: "register" })}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-xs font-medium text-foreground shadow-2xs hover:bg-muted transition-colors cursor-pointer"
    >
      <KeyRound className="size-3.5 text-muted-foreground" />
      <span>Register a passkey on this device</span>
    </button>
  );
}
