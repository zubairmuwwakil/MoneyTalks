"use client";

import { useRef, useState } from "react";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { TX_TYPES } from "@/lib/validation/csv-import";
import { previewCsv, type CsvPreviewResult } from "./actions";

const input = "mt-1 w-full rounded border px-2 py-1 text-sm";

export function CsvImportForm({
  accountId,
  currency,
  importAction,
}: {
  accountId: string;
  currency: Currency;
  importAction: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<CsvPreviewResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  async function handlePreview() {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setPreview({ ok: false, error: "Choose a CSV file first" });
      return;
    }
    setIsPreviewing(true);
    try {
      setPreview(await previewCsv(formData));
    } finally {
      setIsPreviewing(false);
    }
  }

  return (
    <form ref={formRef} action={importAction} className="space-y-3">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
      <div className="grid grid-cols-3 gap-3 text-sm">
        <label>Date column #<input name="dateCol" defaultValue={0} className={input} /></label>
        <label>Description column #<input name="descriptionCol" defaultValue={1} className={input} /></label>
        <label>Amount column #<input name="amountCol" defaultValue={2} className={input} /></label>
        <label>Date format
          <select name="dateFormat" className={input}>
            <option value="YMD">YYYY-MM-DD</option>
            <option value="MDY">MM/DD/YYYY</option>
            <option value="DMY">DD/MM/YYYY</option>
          </select>
        </label>
        <label>Positive amounts are
          <select name="positiveType" className={input}>
            {TX_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>Negative amounts are
          <select name="negativeType" defaultValue="WITHDRAWAL" className={input}>
            {TX_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="hasHeader" value="true" defaultChecked /> First row is a header
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="negate" value="true" /> Flip signs (statement shows spending as positive)
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">
          Import
        </button>
        <button
          type="button"
          onClick={handlePreview}
          disabled={isPreviewing}
          className="rounded border px-4 py-2 text-sm disabled:opacity-50"
        >
          Preview
        </button>
        {isPreviewing ? <span className="text-sm text-muted-foreground">Loading preview…</span> : null}
      </div>

      {preview ? (
        preview.ok ? (
          <div className="space-y-2 rounded border p-3 text-sm">
            <p>
              {preview.totalMapped} row{preview.totalMapped === 1 ? "" : "s"} mapped, {preview.totalErrors} error
              {preview.totalErrors === 1 ? "" : "s"}
            </p>
            {preview.rows && preview.rows.length > 0 ? (
              <>
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">First {preview.rows.length} mapped rows</caption>
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pr-3 font-normal">Date</th>
                      <th className="pr-3 font-normal">Description</th>
                      <th className="pr-3 font-normal">Amount</th>
                      <th className="font-normal">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="pr-3">{r.date}</td>
                        <td className="pr-3">{r.description}</td>
                        <td className="pr-3 tabular-nums">{formatMinorUnits(r.amountMinor, currency)}</td>
                        <td>{r.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground">
                  MoneyTalks stores amounts unsigned and carries the direction in the transaction
                  type — Amount and Type above are exactly what Import will save for each row.
                </p>
              </>
            ) : null}
            {preview.errorRows && preview.errorRows.length > 0 ? (
              <ul className="text-red-600">
                {preview.errorRows.map((er) => (
                  <li key={er.rowIndex}>
                    row {er.rowIndex}: {er.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-red-600">{preview.error}</p>
        )
      ) : null}
    </form>
  );
}
