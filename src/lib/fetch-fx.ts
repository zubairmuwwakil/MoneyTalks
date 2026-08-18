const VALET_BASE = "https://www.bankofcanada.ca/valet/observations";
const VALET_URL = `${VALET_BASE}/FXUSDCAD/json?recent=1`;

/** Currencies the Bank of Canada publishes a direct CAD pair for. */
export const SUPPORTED_FX_CURRENCIES = ["USD", "EUR", "GBP"] as const;

export type CadRate = { base: string; quote: "CAD"; rate: number; asOf: string };

/**
 * Extracts the most recent {rate, asOf} pair from a Bank of Canada Valet
 * observations payload. Pure — no fetch, no clock — so it can be unit
 * tested against a fixture. Returns null on any shape it doesn't recognize
 * rather than throwing, since the caller treats a bad payload the same as
 * a failed fetch.
 */
export function parseValetObservation(
  json: unknown,
  series: string,
): { rate: number; asOf: string } | null {
  if (typeof json !== "object" || json === null) return null;
  const observations = (json as { observations?: unknown }).observations;
  if (!Array.isArray(observations) || observations.length === 0) return null;
  const latest = observations[observations.length - 1] as Record<string, unknown>;
  const d = latest.d;
  const cell = latest[series] as { v?: unknown } | undefined;
  const rate = Number(cell?.v);
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return { rate, asOf: d };
}

/**
 * Thin network wrapper around the Valet API. Not unit tested directly —
 * the parser above carries the coverage. Every failure path (non-200,
 * timeout, network error, malformed JSON) returns null; nothing here ever
 * throws, so a caller can treat this exactly like "no rate available."
 */
export async function fetchUsdCadRate(): Promise<{ rate: number; asOf: string } | null> {
  try {
    const res = await fetch(VALET_URL, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return null;
    return parseValetObservation(await res.json(), "FXUSDCAD");
  } catch {
    return null;
  }
}

/**
 * Map a multi-series Valet payload to CAD-quoted rates. A currency the payload
 * omits is skipped rather than failing the batch — one unavailable series must
 * not cost us the rates that did arrive.
 */
export function parseValetRates(json: unknown, currencies: readonly string[]): CadRate[] {
  const rates: CadRate[] = [];

  for (const currency of currencies) {
    // CAD->CAD is identity; the ledger never needs a rate for it.
    if (currency === "CAD") continue;

    const hit = parseValetObservation(json, `FX${currency}CAD`);
    if (!hit) continue;

    rates.push({ base: currency, quote: "CAD", rate: hit.rate, asOf: hit.asOf });
  }

  return rates;
}

/**
 * Fetch every supported pair in one request. Like fetchUsdCadRate, no failure
 * path throws: an unreachable or malformed source yields an empty list, which
 * the caller treats exactly as "no rates available".
 */
export async function fetchCadRates(
  currencies: readonly string[] = SUPPORTED_FX_CURRENCIES,
): Promise<CadRate[]> {
  const series = currencies.filter((c) => c !== "CAD").map((c) => `FX${c}CAD`);
  if (series.length === 0) return [];

  try {
    const res = await fetch(`${VALET_BASE}/${series.join(",")}/json?recent=1`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return parseValetRates(await res.json(), currencies);
  } catch {
    return [];
  }
}
