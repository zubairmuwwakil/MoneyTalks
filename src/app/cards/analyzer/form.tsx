"use client";

import { useState } from "react";
import { CATEGORY_LABELS } from "@/engine/cards/types";
import { analyzeCsv, type AnalyzeResult } from "./actions";

const input = "mt-1 w-full rounded border px-2 py-1 text-sm";

export function AnalyzerForm({ cards }: { cards: Array<{ id: string; nickname: string }> }) {
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fmt = (minor: number) => `$${(minor / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <form
        action={async (formData: FormData) => {
          setIsAnalyzing(true);
          try {
            setResult(await analyzeCsv(formData));
          } finally {
            setIsAnalyzing(false);
          }
        }}
        className="space-y-3"
      >
        <label className="block text-sm">
          Statement belongs to
          <select name="cardId" className={input}>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
              </option>
            ))}
          </select>
        </label>
        <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        <div className="grid grid-cols-3 gap-3 text-sm">
          <label>
            Date col #<input name="dateCol" defaultValue={0} className={input} />
          </label>
          <label>
            Desc col #<input name="descriptionCol" defaultValue={1} className={input} />
          </label>
          <label>
            Amount col #<input name="amountCol" defaultValue={2} className={input} />
          </label>
        </div>
        <div className="flex gap-4 text-sm">
          <label>
            Date format{" "}
            <select name="dateFormat" className="rounded border px-2 py-1">
              <option value="MDY">MM/DD/YYYY</option>
              <option value="YMD">YYYY-MM-DD</option>
              <option value="DMY">DD/MM/YYYY</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="hasHeader" value="true" defaultChecked /> Header row
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="negate" value="true" /> Flip signs
          </label>
        </div>
        <button
          type="submit"
          disabled={isAnalyzing}
          className="rounded bg-foreground px-4 py-2 text-sm text-background disabled:opacity-50"
        >
          Analyze
        </button>
        {isAnalyzing ? <span className="ml-3 text-sm text-muted-foreground">Analyzing…</span> : null}
      </form>

      {result && !result.ok ? <p className="text-sm text-red-600">{result.error}</p> : null}
      {result?.ok ? (
        <section className="space-y-3" data-testid="analyzer-report">
          <p className="text-lg font-semibold">You left {fmt(result.report.missedMinor)} on the table</p>
          <p className="text-sm text-muted-foreground">
            {fmt(result.report.totalSpendMinor)} spend on {result.cardNickname} earned{" "}
            {fmt(result.report.earnedMinor)}; the wallet&apos;s best cards would have earned{" "}
            {fmt(result.report.optimalMinor)}. Suggested ROI-meter estimate for this card:{" "}
            {fmt(result.report.earnedMinor)}.
          </p>
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1">Category</th>
                <th>Spend</th>
                <th>Earned</th>
                <th>Optimal</th>
                <th>Use instead</th>
              </tr>
            </thead>
            <tbody>
              {result.report.byCategory.map((row) => (
                <tr key={row.category} className="border-b">
                  <td className="py-1">{CATEGORY_LABELS[row.category]}</td>
                  <td>{fmt(row.spendMinor)}</td>
                  <td>{fmt(row.earnedMinor)}</td>
                  <td>{fmt(row.optimalMinor)}</td>
                  <td>{row.bestCardNickname ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
