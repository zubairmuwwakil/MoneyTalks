"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  FileCode2,
  Globe2,
  Info,
  Loader2,
  Plus,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react";
import { createAccount } from "@/app/investments/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type AccountType =
  | "RRSP"
  | "TFSA"
  | "RDSP"
  | "FHSA"
  | "ROTH_IRA"
  | "NON_REGISTERED"
  | "CASH"
  | "CHEQUING"
  | "CRYPTO";

type Currency = "CAD" | "USD" | "JMD";

interface Preset {
  id: string;
  label: string;
  institution: string;
  name: string;
  type: AccountType;
  country: string;
  currency: Currency;
  isUSSitus: boolean;
  tag: string;
}

const PRESETS: Preset[] = [
  {
    id: "ws-tfsa",
    label: "🇨🇦 Wealthsimple TFSA",
    institution: "Wealthsimple",
    name: "Wealthsimple TFSA",
    type: "TFSA",
    country: "CA",
    currency: "CAD",
    isUSSitus: false,
    tag: "Registered",
  },
  {
    id: "qt-rrsp",
    label: "🇨🇦 Questrade RRSP",
    institution: "Questrade",
    name: "Questrade RRSP",
    type: "RRSP",
    country: "CA",
    currency: "CAD",
    isUSSitus: false,
    tag: "Retirement",
  },
  {
    id: "ws-fhsa",
    label: "🇨🇦 First Home (FHSA)",
    institution: "Wealthsimple",
    name: "Wealthsimple FHSA",
    type: "FHSA",
    country: "CA",
    currency: "CAD",
    isUSSitus: false,
    tag: "First Home",
  },
  {
    id: "ibkr-margin",
    label: "🇺🇸 IBKR Margin (USD)",
    institution: "Interactive Brokers",
    name: "IBKR Margin",
    type: "NON_REGISTERED",
    country: "US",
    currency: "USD",
    isUSSitus: true,
    tag: "Taxable / US-Situs",
  },
  {
    id: "fidelity-roth",
    label: "🇺🇸 Fidelity Roth IRA",
    institution: "Fidelity",
    name: "Fidelity Roth IRA",
    type: "ROTH_IRA",
    country: "US",
    currency: "USD",
    isUSSitus: true,
    tag: "US Retirement",
  },
  {
    id: "eq-cash",
    label: "💰 Cash / HISA",
    institution: "EQ Bank",
    name: "High-Interest Savings",
    type: "CASH",
    country: "CA",
    currency: "CAD",
    isUSSitus: false,
    tag: "Liquid Cash",
  },
  {
    id: "cold-crypto",
    label: "⚡ Crypto Cold Storage",
    institution: "Ledger",
    name: "Cold Storage Vault",
    type: "CRYPTO",
    country: "CA",
    currency: "CAD",
    isUSSitus: false,
    tag: "Digital Assets",
  },
];

const ACCOUNT_TYPE_DETAILS: Record<
  AccountType,
  { label: string; subtext: string; category: string }
> = {
  TFSA: {
    label: "Tax-Free Savings Account (TFSA)",
    subtext: "Tax-free investment growth and withdrawals in Canada.",
    category: "Registered (CA)",
  },
  RRSP: {
    label: "Registered Retirement Savings Plan (RRSP)",
    subtext: "Tax-deductible contributions for retirement savings.",
    category: "Registered (CA)",
  },
  FHSA: {
    label: "First Home Savings Account (FHSA)",
    subtext: "Tax-deductible in, tax-free out for first home purchases.",
    category: "Registered (CA)",
  },
  RDSP: {
    label: "Registered Disability Savings Plan (RDSP)",
    subtext: "Tax-assisted long-term savings with Canada disability grants.",
    category: "Registered (CA)",
  },
  ROTH_IRA: {
    label: "Roth IRA (US)",
    subtext: "US after-tax retirement account with tax-free qualified withdrawals.",
    category: "US Qualified",
  },
  NON_REGISTERED: {
    label: "Non-Registered / Margin / Taxable",
    subtext: "Taxable investment account. Tracks capital gains and adjusted cost base (ACB).",
    category: "Taxable",
  },
  CASH: {
    label: "Cash & High-Interest Savings",
    subtext: "Liquid cash, high-interest savings, or cash management accounts.",
    category: "Cash & Banking",
  },
  CHEQUING: {
    label: "Chequing Account",
    subtext: "Day-to-day transactional banking account.",
    category: "Cash & Banking",
  },
  CRYPTO: {
    label: "Cryptocurrency & Digital Assets",
    subtext: "Hardware wallet, exchange, or on-chain assets.",
    category: "Alternative",
  },
};

const inputStyle =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";

export function NewAccountForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [activeTab, setActiveTab] = useState<"manual" | "import">("manual");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [type, setType] = useState<AccountType>("TFSA");
  const [countryChoice, setCountryChoice] = useState<"CA" | "US" | "JM" | "OTHER">("CA");
  const [customCountry, setCustomCountry] = useState("");
  const [currency, setCurrency] = useState<Currency>("CAD");
  const [isUSSitus, setIsUSSitus] = useState(false);
  const [initialCashBalance, setInitialCashBalance] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const activeCountry = countryChoice === "OTHER" ? customCountry.toUpperCase().trim() : countryChoice;

  function applyPreset(preset: Preset) {
    setSelectedPreset(preset.id);
    setName(preset.name);
    setInstitution(preset.institution);
    setType(preset.type);
    if (preset.country === "CA" || preset.country === "US" || preset.country === "JM") {
      setCountryChoice(preset.country);
      setCustomCountry("");
    } else {
      setCountryChoice("OTHER");
      setCustomCountry(preset.country);
    }
    setCurrency(preset.currency);
    setIsUSSitus(preset.isUSSitus);
    setFormError(null);
  }

  function handleCountryChange(newCountry: "CA" | "US" | "JM" | "OTHER") {
    setCountryChoice(newCountry);
    setSelectedPreset(null);
    if (newCountry === "US") {
      setCurrency("USD");
      setIsUSSitus(true);
    } else if (newCountry === "CA") {
      setIsUSSitus(false);
    }
  }

  function handleTypeChange(newType: AccountType) {
    setType(newType);
    setSelectedPreset(null);
    if (newType === "ROTH_IRA") {
      setCountryChoice("US");
      setCurrency("USD");
      setIsUSSitus(true);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const effectiveCountry = countryChoice === "OTHER" ? customCountry.toUpperCase().trim() : countryChoice;

    if (!effectiveCountry || !/^[A-Z]{2}$/.test(effectiveCountry)) {
      setFormError("Country must be a valid 2-letter ISO code (e.g. CA, US, GB).");
      return;
    }

    const formData = new FormData();
    formData.append("name", name);
    formData.append("institution", institution);
    formData.append("type", type);
    formData.append("country", effectiveCountry);
    formData.append("currency", currency);
    if (isUSSitus) {
      formData.append("isUSSitus", "true");
    }
    if (initialCashBalance.trim()) {
      formData.append("initialCashBalance", initialCashBalance.trim());
    }

    startTransition(async () => {
      try {
        const result = await createAccount(formData);
        if (result.ok) {
          if (result.id) {
            router.push(`/investments/${result.id}`);
          } else {
            router.push("/investments");
          }
        } else {
          setFormError(result.error);
        }
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Mode / Tab Switcher */}
      <div className="flex rounded-lg border border-border/80 bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("manual")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
            activeTab === "manual"
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Plus className="size-3.5" />
          <span>Manual Account Setup</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("import")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
            activeTab === "import"
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Upload className="size-3.5" />
          <span>Bulk Import (JSON / CSV)</span>
        </button>
      </div>

      {activeTab === "import" ? (
        <Card className="border-border/80">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileCode2 className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Bulk Import Data</CardTitle>
            </div>
            <CardDescription>
              Already have export files from your brokerage or an In Unity JSON backup?
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-foreground/10 p-2 text-foreground">
                  <FileCode2 className="size-5" />
                </div>
                <div className="flex-1 text-xs">
                  <p className="font-semibold text-foreground">JSON Full Portfolio Import</p>
                  <p className="text-muted-foreground mt-0.5">
                    Import multiple accounts, historical balance snapshots, holdings, and FX rates in one idempotent upload.
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="w-full">
                <Link href="/investments/import" className="flex items-center justify-center gap-1.5">
                  <Upload className="size-3.5" />
                  <span>Go to JSON Import Tool</span>
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>

            <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">💡 Tip for Brokerage CSVs:</p>
              <p>
                To import Questrade, Wealthsimple, or Interactive Brokers activity CSVs, first create the account here using the manual form (or a 1-click preset), then click <strong>Import CSV</strong> on the account page.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* 1-Click Quick Presets */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Sparkles className="size-3.5 text-amber-500" />
                <span>1-Click Popular Presets</span>
              </label>
              <span className="text-[11px] text-muted-foreground">Click to auto-populate</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? "border-foreground bg-foreground text-background shadow-xs"
                        : "border-border/80 bg-muted/30 text-foreground hover:bg-muted hover:border-border"
                    }`}
                  >
                    <span>{preset.label}</span>
                    <span
                      className={`rounded px-1 py-0.2 text-[10px] font-mono ${
                        isSelected ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {preset.currency}
                    </span>
                    {isSelected ? <Check className="size-3 ml-0.5" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Error Banner */}
          {formError ? (
            <div
              className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-600 dark:text-red-400"
              role="alert"
            >
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div className="flex-1">{formError}</div>
            </div>
          ) : null}

          {/* Form Card */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Account Details</CardTitle>
              </div>
              <CardDescription>
                Specify the institution, tax registration type, and baseline currency.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Account Name */}
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Account Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    name="name"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setSelectedPreset(null);
                    }}
                    required
                    placeholder="e.g. Wealthsimple TFSA, Questrade RRSP, Cold Card"
                    className={inputStyle}
                  />
                </div>

                {/* Institution */}
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Financial Institution <span className="text-red-500">*</span>
                  </label>
                  <input
                    name="institution"
                    value={institution}
                    onChange={(e) => {
                      setInstitution(e.target.value);
                      setSelectedPreset(null);
                    }}
                    required
                    placeholder="e.g. Wealthsimple, RBC, Questrade, Interactive Brokers, Fidelity"
                    className={inputStyle}
                  />
                </div>

                {/* Account Type */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-foreground">
                      Account Type &amp; Tax Category <span className="text-red-500">*</span>
                    </label>
                    <span className="text-[11px] text-muted-foreground">
                      {ACCOUNT_TYPE_DETAILS[type].category}
                    </span>
                  </div>
                  <select
                    name="type"
                    value={type}
                    onChange={(e) => handleTypeChange(e.target.value as AccountType)}
                    required
                    className={inputStyle}
                  >
                    {(Object.keys(ACCOUNT_TYPE_DETAILS) as AccountType[]).map((t) => (
                      <option key={t} value={t}>
                        {ACCOUNT_TYPE_DETAILS[t].label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {ACCOUNT_TYPE_DETAILS[type].subtext}
                  </p>
                </div>

                {/* Country and Currency */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Account Country <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={countryChoice}
                      onChange={(e) =>
                        handleCountryChange(e.target.value as "CA" | "US" | "JM" | "OTHER")
                      }
                      className={inputStyle}
                    >
                      <option value="CA">🇨🇦 Canada (CA)</option>
                      <option value="US">🇺🇸 United States (US)</option>
                      <option value="JM">🇯🇲 Jamaica (JM)</option>
                      <option value="OTHER">🌐 Other Country (ISO code)</option>
                    </select>

                    {countryChoice === "OTHER" ? (
                      <input
                        type="text"
                        placeholder="2-letter ISO (e.g. GB)"
                        value={customCountry}
                        onChange={(e) => setCustomCountry(e.target.value.toUpperCase().slice(0, 2))}
                        maxLength={2}
                        required
                        className={`${inputStyle} mt-2 uppercase`}
                      />
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Denomination Currency <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="currency"
                      value={currency}
                      onChange={(e) => {
                        setCurrency(e.target.value as Currency);
                        setSelectedPreset(null);
                      }}
                      required
                      className={inputStyle}
                    >
                      <option value="CAD">CAD — Canadian Dollar ($)</option>
                      <option value="USD">USD — US Dollar ($)</option>
                      <option value="JMD">JMD — Jamaican Dollar (J$)</option>
                    </select>
                  </div>
                </div>

                {/* US-Situs Checkbox */}
                <div className="rounded-lg border border-border/80 bg-muted/20 p-3 transition-colors">
                  <label className="flex items-start gap-2.5 text-xs font-medium text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      name="isUSSitus"
                      checked={isUSSitus}
                      onChange={(e) => {
                        setIsUSSitus(e.target.checked);
                        setSelectedPreset(null);
                      }}
                      className="rounded mt-0.5"
                    />
                    <div>
                      <span>US-situs account (held with a US financial institution)</span>
                      <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                        Check if this account is maintained directly by a US broker or US bank (e.g. Fidelity US, Schwab US, Chase US).
                      </p>
                    </div>
                  </label>
                </div>

                {/* Optional Starting Cash Balance */}
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Initial Cash Balance (Optional)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-mono text-muted-foreground pointer-events-none">
                      {currency === "CAD" ? "CAD $" : currency === "USD" ? "USD $" : "JMD $"}
                    </span>
                    <input
                      type="text"
                      name="initialCashBalance"
                      value={initialCashBalance}
                      onChange={(e) => setInitialCashBalance(e.target.value)}
                      placeholder="0.00"
                      className={`${inputStyle} pl-16 font-mono`}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Seeds your cash balance snapshot immediately upon creation.
                  </p>
                </div>

                {/* Dynamic Cross-Border & Tax Intelligence Callout */}
                {(type === "TFSA" || type === "FHSA") && (activeCountry === "US" || isUSSitus) ? (
                  <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                    <ShieldAlert className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div className="space-y-1">
                      <p className="font-semibold">US Taxpayer / Cross-Border Notice</p>
                      <p className="text-[11px] leading-relaxed">
                        The IRS does not recognize the tax-free status of Canadian TFSAs or FHSAs. US persons (citizens, Green Card holders, or US residents) may be subject to foreign grantor trust filings (Form 3520/3520-A) and PFIC rules.
                      </p>
                    </div>
                  </div>
                ) : null}

                {type === "ROTH_IRA" ? (
                  <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-800 dark:text-sky-300">
                    <Info className="size-4 shrink-0 mt-0.5 text-sky-600 dark:text-sky-400" />
                    <div className="space-y-1">
                      <p className="font-semibold">Canadian Resident Roth IRA Election</p>
                      <p className="text-[11px] leading-relaxed">
                        Under Article XVIII of the Canada-US Tax Treaty, Canadian residents should ensure a one-time treaty election is filed with the CRA. Avoid making new contributions while Canadian-resident to prevent permanently tainting tax-exempt status.
                      </p>
                    </div>
                  </div>
                ) : null}

                {isUSSitus && type !== "ROTH_IRA" ? (
                  <div className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-muted/30 p-3 text-xs text-muted-foreground">
                    <Globe2 className="size-4 shrink-0 mt-0.5 text-foreground" />
                    <div className="space-y-0.5">
                      <p className="font-semibold text-foreground">FBAR &amp; Form 8938 Tracking</p>
                      <p className="text-[11px]">
                        This account will be flagged as US-situs for your foreign asset tracking and reporting aggregate threshold alerts.
                      </p>
                    </div>
                  </div>
                ) : null}

                {type === "NON_REGISTERED" && !isUSSitus ? (
                  <div className="flex items-start gap-2.5 rounded-lg border border-border/80 bg-muted/30 p-3 text-xs text-muted-foreground">
                    <Info className="size-4 shrink-0 mt-0.5 text-foreground" />
                    <div className="space-y-0.5">
                      <p className="font-semibold text-foreground">ACB &amp; Superficial Loss Tracking</p>
                      <p className="text-[11px]">
                        In Unity tracks multi-currency adjusted cost base (ACB), trade conversions, and capital gain allocations for non-registered accounts.
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Submit Button */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isPending}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>Creating account...</span>
                      </>
                    ) : (
                      <>
                        <span>Create account</span>
                        <ArrowRight className="size-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
