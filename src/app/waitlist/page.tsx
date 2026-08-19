"use client";

import { useState } from "react";

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to join waitlist");
      }

      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 rounded-lg border p-8 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Inunity</h1>
          <p className="mt-2 text-sm text-gray-600">
            Join the invite-only beta. Enter your email to request access.
          </p>
        </div>

        {status === "success" ? (
          <div className="rounded-md bg-green-50 p-4 text-center text-green-700">
            <p>You&apos;re on the list! We&apos;ll be in touch.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full rounded-md border p-2"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "loading"}
              />
            </div>
            {status === "error" && (
              <p className="text-sm text-red-600">{errorMessage}</p>
            )}
            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-md bg-black p-2 text-white disabled:opacity-50"
            >
              {status === "loading" ? "Submitting..." : "Join Waitlist"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
