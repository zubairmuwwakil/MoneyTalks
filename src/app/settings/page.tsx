import { redirect } from "next/navigation";
import {
  Coins,
  DollarSign,
  Globe2,
  HeartHandshake,
  Plus,
  Save,
  Shield,
  Trash2,
  User,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { IncomeSource } from "@/engine/rules/types";
import { formatMinorUnits, minorToDollarInput } from "@/engine/money";
import { getOrCreateProfile } from "@/lib/profile";
import { requireUserId } from "@/lib/require-user";
import { addIncomeSource, removeIncomeSource, updateProfile } from "./actions";

const input =
  "mt-1 flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";
const label = "block text-xs font-medium text-foreground";

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
    <main className="max-w-3xl space-y-8 py-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your personal residency, tax filing status, registered account room, and income sources.
        </p>
      </div>

      <form action={submitProfile} className="space-y-6">
        <h2 className="sr-only">Profile (drives every rule in Money Finder)</h2>

        {/* Section 1: Personal & Tax Residency */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Globe2 className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Personal &amp; Tax Status</CardTitle>
            </div>
            <CardDescription>
              Residency, citizenships, and cross-border US filing status for compliance checks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={label}>
                Residency (2-letter)
                <input
                  name="residency"
                  defaultValue={profile.residency}
                  pattern="[A-Z]{2}"
                  placeholder="CA"
                  className={input}
                />
              </label>
              <label className={label}>
                Citizenships (comma-sep)
                <input
                  name="citizenships"
                  defaultValue={profile.citizenships.join(", ")}
                  placeholder="CA, US, JM"
                  className={input}
                />
              </label>
              <label className={label}>
                US filing status
                <select name="filingStatus" defaultValue={profile.filingStatus} className={input}>
                  <option value="SINGLE_ABROAD">Single, living abroad</option>
                  <option value="MFJ_ABROAD">Married filing jointly, abroad</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className={label}>
                US marginal rate %
                <input
                  name="marginalUSRatePct"
                  type="number"
                  defaultValue={profile.marginalUSRatePct}
                  className={input}
                />
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Registered Accounts & RDSP */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Registered Accounts &amp; RDSP Grants</CardTitle>
            </div>
            <CardDescription>
              Contribution rooms from your latest CRA Notice of Assessment and CDSG grant parameters.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className={label}>
                TFSA room ($, from CRA)
                <input
                  name="tfsaRoomMinor"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={minorToDollarInput(profile.tfsaRoomMinor)}
                  className={input}
                />
              </label>
              <label className={label}>
                RRSP room ($, from CRA)
                <input
                  name="rrspRoomMinor"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={minorToDollarInput(profile.rrspRoomMinor)}
                  className={input}
                />
              </label>
              <label className={label}>
                FHSA room ($, from CRA)
                <input
                  name="fhsaRoomMinor"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={minorToDollarInput(profile.fhsaRoomMinor)}
                  className={input}
                />
              </label>
            </div>

            <div className="border-t border-border/60 pt-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Registered Disability Savings Plan (RDSP)
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className={label}>
                  RDSP income tier
                  <select name="rdspIncomeTier" defaultValue={profile.rdspIncomeTier} className={input}>
                    <option value="LOW">LOW (below CDSG family-income threshold)</option>
                    <option value="HIGH">HIGH (above threshold)</option>
                    <option value="UNKNOWN">Unknown</option>
                  </select>
                </label>
                <label className={label}>
                  RDSP carry-forward years (unused, last 10)
                  <input
                    name="rdspCarryForwardYears"
                    type="number"
                    defaultValue={profile.rdspCarryForwardYears}
                    className={input}
                  />
                </label>
                <label className={label}>
                  RDSP lifetime grants received ($)
                  <input
                    name="rdspGrantsLifetimeMinor"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={minorToDollarInput(profile.rdspGrantsLifetimeMinor)}
                    className={input}
                  />
                </label>
                <label className={label}>
                  RDSP lifetime contributions ($)
                  <input
                    name="rdspContribLifetimeMinor"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={minorToDollarInput(profile.rdspContribLifetimeMinor)}
                    className={input}
                  />
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Cash Cushion & Programs */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <HeartHandshake className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Cash Cushion &amp; Benefit Programs</CardTitle>
            </div>
            <CardDescription>
              Emergency liquidity floor and special program eligibility.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={label}>
                Cash cushion ($)
                <input
                  name="cushionMinor"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={minorToDollarInput(profile.cushionMinor)}
                  className={input}
                />
              </label>
              <label className={label}>
                Benefit programs (OW, ODSP)
                <input
                  name="benefitPrograms"
                  defaultValue={profile.benefitPrograms.join(", ")}
                  placeholder="e.g. ODSP"
                  className={input}
                />
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Cash cushion is the balance you want your cash + chequing accounts to stay above.
              Set it above $0 to enable a future warning when a projected month dips under it.
            </p>

            <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
              <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  name="dtcEligible"
                  value="true"
                  defaultChecked={profile.dtcEligible}
                  className="rounded"
                />
                <span>Disability Tax Credit (DTC) eligible</span>
              </label>
              <label className="flex items-center gap-2.5 text-xs font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  name="nhtContributed"
                  value="true"
                  defaultChecked={profile.nhtContributed}
                  className="rounded"
                />
                <span>Has contributed to Jamaica National Housing Trust (NHT)</span>
              </label>
            </div>
          </CardContent>
        </Card>

        <div>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-5 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
          >
            <Save className="size-3.5" />
            <span>Save profile</span>
          </button>
        </div>

        {errorForm === "profile" && error ? (
          <p className="text-xs font-medium text-red-600 rounded-lg bg-red-500/10 p-3 border border-red-500/20" role="alert">
            {error}
          </p>
        ) : null}
      </form>

      {/* Income Sources Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Coins className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Income Sources</CardTitle>
          </div>
          <CardDescription>
            Recurring cash inflows to power multi-month cash cushion projections.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y divide-border/60 rounded-lg border border-border/80 bg-background overflow-hidden">
            {profile.incomeSources.map((s: IncomeSource, i: number) => (
              <li key={i} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="space-y-0.5">
                  <span className="font-semibold text-xs text-foreground">{s.name}</span>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">
                      {s.kind}
                    </Badge>
                    <span>·</span>
                    <span>{s.cadence.toLowerCase()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 tabular-nums">
                  <span className="font-semibold text-sm text-foreground">
                    {formatMinorUnits(s.amountMinor, "CAD")}
                  </span>
                  <form action={submitRemoveIncome}>
                    <input type="hidden" name="index" value={i} />
                    <button
                      type="submit"
                      className="p-1 text-muted-foreground hover:text-red-600 transition-colors cursor-pointer"
                      title="Remove income source"
                    >
                      <Trash2 className="size-3.5 text-red-600" />
                    </button>
                  </form>
                </div>
              </li>
            ))}
            {profile.incomeSources.length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                No income sources logged. Add your salary or recurring benefits below.
              </li>
            ) : null}
          </ul>

          <div className="border-t border-border/60 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Add Income Source
            </p>
            <form action={submitAddIncome} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              <input name="name" placeholder="Name (e.g. Primary Job)" required className={input} />
              <input name="amountMinor" placeholder="Amount ($)" required className={input} />
              <select name="cadence" className={input}>
                <option>MONTHLY</option>
                <option>BIWEEKLY</option>
                <option>ANNUAL</option>
              </select>
              <select name="kind" className={input}>
                <option>EMPLOYMENT</option>
                <option>SELF_EMPLOYMENT</option>
                <option>BENEFIT</option>
                <option>RENTAL</option>
                <option>OTHER</option>
              </select>
              <button
                type="submit"
                className="col-span-2 sm:col-span-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer"
              >
                <Plus className="size-3.5" />
                <span>Add</span>
              </button>
            </form>
            {errorForm === "income" && error ? (
              <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
