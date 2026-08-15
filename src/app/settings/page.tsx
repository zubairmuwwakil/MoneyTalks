import { redirect } from "next/navigation";
import type { IncomeSource } from "@/engine/rules/types";
import { formatMinorUnits, minorToDollarInput } from "@/engine/money";
import { getOrCreateProfile } from "@/lib/profile";
import { requireUserId } from "@/lib/require-user";
import { addIncomeSource, removeIncomeSource, updateProfile } from "./actions";

const input = "mt-1 w-full rounded border px-3 py-2 text-sm";
const label = "block text-sm";

function settingsErrorPath(form: string, message: string) {
  return `/settings?errorForm=${form}&error=${encodeURIComponent(message)}`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; errorForm?: string }>;
}) {
  const userId = await requireUserId();
  const profile = await getOrCreateProfile(userId);
  const { error, errorForm } = await searchParams;

  // Server actions return a result object; a form action must resolve to void, so each
  // form gets a thin wrapper that turns a failure into a visible message (same pattern
  // as the investments detail page).
  async function submitProfile(formData: FormData) {
    "use server";
    const result = await updateProfile(formData);
    if (!result.ok) redirect(settingsErrorPath("profile", result.error));
    redirect("/settings");
  }

  async function submitAddIncome(formData: FormData) {
    "use server";
    const result = await addIncomeSource(formData);
    if (!result.ok) redirect(settingsErrorPath("income", result.error));
    redirect("/settings");
  }

  async function submitRemoveIncome(formData: FormData) {
    "use server";
    const result = await removeIncomeSource(formData);
    if (!result.ok) redirect(settingsErrorPath("income", result.error));
    redirect("/settings");
  }

  return (
    <main className="max-w-2xl space-y-10 py-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <form action={submitProfile} className="space-y-4">
        <h2 className="font-medium">Profile (drives every rule in Money Finder)</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className={label}>Residency (2-letter)
            <input name="residency" defaultValue={profile.residency} pattern="[A-Z]{2}" className={input} />
          </label>
          <label className={label}>Citizenships (comma-sep)
            <input name="citizenships" defaultValue={profile.citizenships.join(", ")} className={input} />
          </label>
          <label className={label}>US filing status
            <select name="filingStatus" defaultValue={profile.filingStatus} className={input}>
              <option value="SINGLE_ABROAD">Single, living abroad</option>
              <option value="MFJ_ABROAD">Married filing jointly, abroad</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className={label}>US marginal rate %
            <input name="marginalUSRatePct" type="number" defaultValue={profile.marginalUSRatePct} className={input} />
          </label>
          <label className={label}>RDSP income tier
            <select name="rdspIncomeTier" defaultValue={profile.rdspIncomeTier} className={input}>
              <option value="LOW">LOW (below CDSG family-income threshold)</option>
              <option value="HIGH">HIGH (above threshold)</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </label>
          <label className={label}>RDSP carry-forward years (unused, last 10)
            <input name="rdspCarryForwardYears" type="number" defaultValue={profile.rdspCarryForwardYears} className={input} />
          </label>
          <label className={label}>RDSP lifetime grants received ($)
            <input name="rdspGrantsLifetimeMinor" type="number" step="0.01" min="0" defaultValue={minorToDollarInput(profile.rdspGrantsLifetimeMinor)} className={input} />
          </label>
          <label className={label}>RDSP lifetime contributions ($)
            <input name="rdspContribLifetimeMinor" type="number" step="0.01" min="0" defaultValue={minorToDollarInput(profile.rdspContribLifetimeMinor)} className={input} />
          </label>
          <label className={label}>TFSA room ($, from CRA)
            <input name="tfsaRoomMinor" type="number" step="0.01" min="0" defaultValue={minorToDollarInput(profile.tfsaRoomMinor)} className={input} />
          </label>
          <label className={label}>RRSP room ($, from CRA)
            <input name="rrspRoomMinor" type="number" step="0.01" min="0" defaultValue={minorToDollarInput(profile.rrspRoomMinor)} className={input} />
          </label>
          <label className={label}>FHSA room ($, from CRA)
            <input name="fhsaRoomMinor" type="number" step="0.01" min="0" defaultValue={minorToDollarInput(profile.fhsaRoomMinor)} className={input} />
          </label>
          <label className={label}>
            Cash cushion ($)
            <input name="cushionMinor" type="number" step="0.01" min="0" defaultValue={minorToDollarInput(profile.cushionMinor)} className={input} />
          </label>
          <label className={label}>Benefit programs (OW, ODSP)
            <input name="benefitPrograms" defaultValue={profile.benefitPrograms.join(", ")} className={input} />
          </label>
        </div>
        <p className="text-xs text-foreground/60">
          Cash cushion is the balance you want your cash + chequing accounts to stay above.
          Set it above $0 to enable a future warning when a projected month dips under it.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="dtcEligible" value="true" defaultChecked={profile.dtcEligible} />
          Disability Tax Credit eligible
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="nhtContributed" value="true" defaultChecked={profile.nhtContributed} />
          Has contributed to Jamaica NHT
        </label>
        <button type="submit" className="rounded bg-foreground px-4 py-2 text-sm text-background">Save profile</button>
        {errorForm === "profile" && error ? (
          <p className="text-sm text-red-600" role="alert">{error}</p>
        ) : null}
      </form>

      <section>
        <h2 className="font-medium">Income sources</h2>
        <ul className="mt-2 divide-y rounded border">
          {profile.incomeSources.map((s: IncomeSource, i: number) => (
            <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{s.name} · {s.kind} · {s.cadence.toLowerCase()}</span>
              <span className="flex items-center gap-3 tabular-nums">
                {formatMinorUnits(s.amountMinor, "CAD")}
                <form action={submitRemoveIncome}>
                  <input type="hidden" name="index" value={i} />
                  <button type="submit" className="text-xs text-red-600">remove</button>
                </form>
              </span>
            </li>
          ))}
        </ul>
        <form action={submitAddIncome} className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <input name="name" placeholder="Name" required className="rounded border px-2 py-1" />
          <input name="amountMinor" placeholder="Amount ($)" required className="rounded border px-2 py-1" />
          <select name="cadence" className="rounded border px-2 py-1">
            <option>MONTHLY</option><option>BIWEEKLY</option><option>ANNUAL</option>
          </select>
          <select name="kind" className="rounded border px-2 py-1">
            <option>EMPLOYMENT</option><option>SELF_EMPLOYMENT</option><option>BENEFIT</option><option>RENTAL</option><option>OTHER</option>
          </select>
          <button type="submit" className="rounded border px-2 py-1">Add</button>
        </form>
        {errorForm === "income" && error ? (
          <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
