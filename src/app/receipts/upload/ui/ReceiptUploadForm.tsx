

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReceiptUploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!file) return;

    setLoading(true);
    setMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("defaultReturnDays", "30");

      const res = await fetch("/api/receipts/upload", { method: "POST", body: fd });
      const text = await res.text();

      let data: unknown = null;
      try { data = JSON.parse(text); } catch {}

      if (!res.ok) {
        const errorMsg =
          data && typeof data === 'object' && 'error' in data
            ? String((data as Record<string, unknown>).error)
            : text ?? "Upload failed";
        setMsg(errorMsg);
        return;
      }

      setMsg("Uploaded. Added to Inbox Review.");
      router.push("/settings/automation/review");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-white/50 p-4 shadow-sm space-y-3">
      <input
        type="file"
        accept=".pdf,image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <button
        className="rounded-xl border px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-60"
        onClick={submit}
        disabled={!file || loading}
      >
        {loading ? "Uploading…" : "Upload"}
      </button>

      {msg ? <div className="text-sm opacity-70">{msg}</div> : null}
      <div className="text-xs opacity-60">Default return window: 30 days.</div>
    </div>
  );
}
