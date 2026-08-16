"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function WalletSettingsClient() {
  const [installations, setInstallations] = useState<any[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function fetchInstallations() {
    const res = await fetch("/api/v1/wallet-installations");
    if (res.ok) {
      setInstallations(await res.json());
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
      const data = await res.json();
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

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900">Your Shortcuts</h2>
          <Button onClick={createInstallation}>New Installation</Button>
        </div>
        
        {newToken && (
          <div className="mb-4 p-4 bg-yellow-50 text-yellow-800 rounded-md">
            <p className="font-semibold mb-2">Save this token now. You won't see it again.</p>
            <code className="block p-2 bg-yellow-100 rounded break-all">{newToken}</code>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setNewToken(null)}>I've saved it</Button>
          </div>
        )}

        {installations.length === 0 ? (
          <p className="text-sm text-gray-500">No installations found. Create one to get started.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {installations.map((inst) => (
              <li key={inst.id} className="py-4 flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-gray-900">{inst.label}</p>
                  <p className="text-xs text-gray-500">
                    Created {new Date(inst.createdAt).toLocaleDateString()}
                    {inst.revokedAt && <span className="ml-2 text-red-500">Revoked</span>}
                  </p>
                </div>
                {!inst.revokedAt && (
                  <Button variant="destructive" size="sm" onClick={() => revokeInstallation(inst.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
