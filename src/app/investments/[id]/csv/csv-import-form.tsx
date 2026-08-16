"use client";

import { useRef, useState } from "react";
import { Eye, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMinorUnits, type Currency } from "@/engine/money";
import { TX_TYPES } from "@/lib/validation/csv-import";
import { previewCsv, type CsvPreviewResult } from "./actions";

const input =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

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
    <form ref={formRef} action={importAction} className="space-y-4">
      <input type="hidden" name="accountId" value={accountId} />

      <div className="rounded-xl border-2 border-dashed border-border/80 bg-muted/20 p-4 text-center">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="w-full text-xs text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-foreground file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-background hover:file:bg-foreground/90 cursor-pointer"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Date column #</label>
          <input name="dateCol" defaultValue={0} className={input} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Description column #</label>
          <input name="descriptionCol" defaultValue={1} className={input} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Amount column #</label>
          <input name="amountCol" defaultValue={2} className={input} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Date format</label>
          <select name="dateFormat" className={input}>
            <option value="YMD">YYYY-MM-DD</option>
            <option value="MDY">MM/DD/YYYY</option>
            <option value="DMY">DD/MM/YYYY</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Positive amounts are</label>
          <select name="positiveType" className={input}>
            {TX_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Negative amounts are</label>
          <select name="negativeType" defaultValue="WITHDRAWAL" className={input}>
            {TX_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
        <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
          <input type="checkbox" name="hasHeader" value="true" defaultChecked className="rounded" />
          <span>First row is a header</span>
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
          <input type="checkbox" name="negate" value="true" className="rounded" />
          <span>Flip signs (statement shows spending as positive)</span>
        </label>
      </div>

      <div className="flex items-center gap-2.5 pt-1">
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
        >
          <Upload className="size-3.5" />
          <span>Import</span>
        </button>
        <button
          type="button"
          onClick={handlePreview}
          disabled={isPreviewing}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border/80 bg-background px-4 text-xs font-semibold text-foreground shadow-2xs hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Eye className="size-3.5" />
          <span>Preview</span>
        </button>
        {isPreviewing ? <span className="text-xs text-muted-foreground">Loading preview…</span> : null}
      </div>

      {preview ? (
        preview.ok ? (
          <div className="space-y-3 rounded-xl border border-border/80 bg-card p-4 text-sm shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-foreground">
                {preview.totalMapped ?? 0} row{(preview.totalMapped ?? 0) === 1 ? "" : "s"} mapped
              </span>
              {(preview.totalErrors ?? 0) > 0 ? (
                <Badge variant="destructive">
                  {preview.totalErrors} error{(preview.totalErrors ?? 0) === 1 ? "" : "s"}
                </Badge>
              ) : (
                <Badge variant="success">All rows valid</Badge>
              )}
            </div>

            {preview.rows && preview.rows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">First {preview.rows.length} mapped rows</caption>
                  <thead>
                    <tr className="border-b border-border/60 text-muted-foreground">
                      <th className="pb-2 pr-3 font-semibold">Date</th>
                      <th className="pb-2 pr-3 font-semibold">Description</th>
                      <th className="pb-2 pr-3 font-semibold">Amount</th>
                      <th className="pb-2 font-semibold">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {preview.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="py-2 pr-3 text-muted-foreground font-mono text-[11px]">{r.date}</td>
                        <td className="py-2 pr-3 font-medium text-foreground">{r.description}</td>
                        <td className="py-2 pr-3 tabular-nums font-semibold text-foreground">
                          {formatMinorUnits(r.amountMinor, currency)}
                        </td>
                        <td className="py-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {r.type}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[11px] text-muted-foreground border-t border-border/40 pt-2">
                  MoneyTalks stores amounts unsigned and carries the direction in the transaction
                  type — Amount and Type above are exactly what Import will save for each row.
                </p>
              </div>
            ) : null}

            {preview.errorRows && preview.errorRows.length > 0 ? (
              <ul className="text-xs text-red-600 space-y-1 rounded-lg bg-red-500/10 p-3 border border-red-500/20">
                {preview.errorRows.map((er) => (
                  <li key={er.rowIndex}>
                    row {er.rowIndex}: {er.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-xs font-medium text-red-600 rounded-lg bg-red-500/10 p-3 border border-red-500/20">
            {preview.error}
          </p>
        )
      ) : null}
    </form>
  );
}
