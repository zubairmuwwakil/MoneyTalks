"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

type WalletInstallation = {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
};

export default function WalletSettingsClient() {
  const [installations, setInstallations] = useState<WalletInstallation[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function fetchInstallations() {
    const res = await fetch("/api/v1/wallet-installations");
    if (res.ok) {
      setInstallations((await res.json()) as WalletInstallation[]);
    }
  }

  useEffect(() => {
    fetchInstallations();
  }, []);

  async function createInstallation() {
    const res = await fetch("/api/v1/wallet-installations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "My iPhone" })
    });
    if (res.ok) {
      const data = (await res.json()) as { token: string };
      setNewToken(data.token);
      await fetchInstallations();
    }
  }

  async function revokeInstallation(id: string) {
    const res = await fetch(`/api/v1/wallet-installations/${id}`, { method: "DELETE" });
    if (res.ok) {
      await fetchInstallations();
    }
  }

  const [copied, setCopied] = useState(false);

  function copyToken(token: string) {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <div className="bg-card p-6 rounded-2xl shadow-2xs border border-border/80">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Apple Wallet Installations</h2>
            <p className="text-xs text-muted-foreground">Manage Bearer tokens for your iOS Shortcuts automations.</p>
          </div>
          <Button onClick={createInstallation} className="rounded-xl font-semibold">New Token</Button>
        </div>
        
        {newToken && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm">Save this token now. It won&apos;t be shown again.</p>
              <Button
                variant="outline"
                size="xs"
                className="rounded-lg text-xs"
                onClick={() => copyToken(newToken)}
              >
                {copied ? "Copied! ✓" : "Copy Token"}
              </Button>
            </div>
            <code className="block p-2.5 bg-background border border-input rounded-xl text-xs font-mono break-all select-all text-foreground">
              {newToken}
            </code>
            <Button variant="secondary" size="sm" className="rounded-xl text-xs" onClick={() => setNewToken(null)}>
              I&apos;ve saved my token
            </Button>
          </div>
        )}

        {installations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active installations. Create one above to get started with Apple Wallet taps.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {installations.map((inst) => (
              <li key={inst.id} className="py-3 flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold text-foreground">{inst.label}</p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(inst.createdAt).toLocaleDateString()}
                    {inst.revokedAt && <span className="ml-2 text-destructive font-medium">Revoked</span>}
                  </p>
                </div>
                {!inst.revokedAt && (
                  <Button variant="outline" size="xs" className="rounded-lg text-xs text-destructive hover:bg-destructive/10" onClick={() => revokeInstallation(inst.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fast iOS Shortcut Setup Card */}
      <div className="bg-card p-6 rounded-2xl shadow-2xs border border-border/80 space-y-4">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <span>📱 iOS Shortcut Setup Guide</span>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure your Apple Pay automation in 2 simple steps.
          </p>
        </div>

        <div className="space-y-3 text-xs text-foreground/90">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 space-y-2">
            <p className="font-semibold text-primary">1. Create a Per-Card Automation in Apple Shortcuts</p>
            <p className="text-muted-foreground">
              Open <strong>Shortcuts → Automation → + → Transaction</strong> → select your credit card → <strong>Run Immediately</strong>.
            </p>
            <div className="bg-background border border-input rounded-lg p-2.5 space-y-1 font-mono text-[11px]">
              <p className="font-sans font-semibold text-xs text-foreground">Automation Dictionary Keys:</p>
              <p>• <span className="text-primary font-bold">merchant</span> → Merchant input chip</p>
              <p>• <span className="text-primary font-bold">card</span> → Card or Pass chip</p>
              <p>• <span className="text-primary font-bold">amount</span> → Amount chip</p>
              <p>• <span className="text-primary font-bold">currency</span> → Currency Code chip</p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 space-y-2">
            <p className="font-semibold text-primary">2. POST to MoneyTalks Endpoint</p>
            <p className="text-muted-foreground">
              Add a <strong>Get Contents of URL</strong> action sending a <strong>POST</strong> request to:
            </p>
            <code className="block p-2 bg-background border border-input rounded-lg font-mono text-[11px] text-foreground select-all">
              {typeof window !== "undefined" ? window.location.origin : "https://your-domain.com"}/api/v1/wallet-events
            </code>
            <p className="text-muted-foreground text-[11px]">
              Header: <code className="font-mono text-foreground">Authorization: Bearer YOUR_TOKEN</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
