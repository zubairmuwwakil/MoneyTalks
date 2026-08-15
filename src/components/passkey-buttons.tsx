"use client";

import { signIn } from "next-auth/webauthn";

export function PasskeySignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("passkey")}
      className="w-full rounded border px-3 py-2"
    >
      Sign in with a passkey
    </button>
  );
}

export function PasskeyRegisterButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("passkey", { action: "register" })}
      className="rounded border px-3 py-1 text-sm"
    >
      Register a passkey on this device
    </button>
  );
}
