"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  CalendarDays,
  CreditCard,
  HelpCircle,
  Info,
  Receipt,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { TaxCalculator } from "@/components/bills/tax-calculator";
import { Badge } from "@/components/ui/badge";

const input =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm shadow-2xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring";
const label = "block text-xs font-medium text-foreground mb-1";

export interface SpendCategoryOption {
  value: string;
  label: string;
}

interface PayeeSuggestion {
  category: string;
  spendCategory: string;
  reason: string;
}

const SMART_PAYEE_RULES: Array<{
  pattern: RegExp;
  category: string;
  spendCategory: string;
  reason: string;
}> = [
  {
    pattern: /pickle|gym|fitness|sport|climb|goodlife|ymca|crossfit|f45|club|racquet|equinox|planet fitness|anytime/i,
    category: "subscriptions",
    spendCategory: "Memberships",
    reason: "Fitness & Club Membership",
  },
  {
    pattern: /netflix|spotify|disney|youtube|crave|hbo|paramount|prime|apple tv|audible|crunchyroll/i,
    category: "subscriptions",
    spendCategory: "Streaming",
    reason: "Digital Media & Streaming",
  },
  {
    pattern: /hydro|enbridge|water|electric|gas|epcor|alecta|toronto hydro|power|utilities/i,
    category: "utilities",
    spendCategory: "Utilities",
    reason: "Municipal & Household Utilities",
  },
  {
    pattern: /rogers|bell|telus|fido|koodo|virgin|freedom|fizz|shaw|cogeco|chatr|public mobile/i,
    category: "utilities",
    spendCategory: "Telecom",
    reason: "Mobile & Home Internet",
  },
  {
    pattern: /presto|ttc|go transit|compass|transit|stm|translink/i,
    category: "transport",
    spendCategory: "Transit",
    reason: "Public Transit & Commuting",
  },
  {
    pattern: /uber|lyft/i,
    category: "transport",
    spendCategory: "Rideshare",
    reason: "Rideshare & Taxis",
  },
  {
    pattern: /insurance|geico|intact|desjardins|aviva|td insurance|belair|sonnet|manulife|sun life/i,
    category: "other",
    spendCategory: "Insurance",
    reason: "Insurance Policy",
  },
  {
    pattern: /rent|mortgage|condo|strata|property tax/i,
    category: "housing",
    spendCategory: "",
    reason: "Housing & Property",
  },
];

function getISODateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getFirstOfCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getFirstOfNextMonth(): string {
  const d = new Date();
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
}

// Payee Intelligence: a pure lookup over SMART_PAYEE_RULES. Deliberately not
// memoized — `RegExp.test` reads as a mutation of the rules array to the React
// Compiler lint, which then cannot preserve a manual useMemo wrapped around it.
function findPayeeSuggestion(
  name: string,
  payee: string,
  category: string,
  spendCategory: string,
): PayeeSuggestion | null {
  const combinedText = `${name} ${payee}`.trim();
  if (!combinedText) return null;

  for (const rule of SMART_PAYEE_RULES) {
    if (rule.pattern.test(combinedText)) {
      // If current settings don't match, suggest them
      if (rule.spendCategory && spendCategory !== rule.spendCategory) {
        return {
          category: rule.category,
          spendCategory: rule.spendCategory,
          reason: rule.reason,
        };
      }
      if (!rule.spendCategory && category !== rule.category) {
        return {
          category: rule.category,
          spendCategory: rule.spendCategory,
          reason: rule.reason,
        };
      }
    }
  }
  return null;
}

export function BillFormFields({ spendCategoryOptions }: { spendCategoryOptions: SpendCategoryOption[] }) {
  const todayIso = useMemo(() => getISODateToday(), []);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("subscriptions");
  const [payee, setPayee] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [spendCategory, setSpendCategory] = useState("");
  const [paymentRail, setPaymentRail] = useState("unknown");
  const [railFeePct, setRailFeePct] = useState("");

  const [type, setType] = useState("MONTHLY");
  const [anchor, setAnchor] = useState(todayIso);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startsFrom, setStartsFrom] = useState("");
  const [from, setFrom] = useState(todayIso);
  const [amount, setAmount] = useState("");

  const [autopay, setAutopay] = useState(false);
  const [variable, setVariable] = useState(false);
  const [notes, setNotes] = useState("");

  // Payee Intelligence Suggestion
  const activeSuggestion = findPayeeSuggestion(name, payee, category, spendCategory);

  const applySuggestion = (suggestion: PayeeSuggestion) => {
    setCategory(suggestion.category);
    if (suggestion.spendCategory) {
      setSpendCategory(suggestion.spendCategory);
    }
  };

  // Cadence JSON & Schedule JSON
  const cadence =
    type === "MONTHLY"
      ? { type, dayOfMonth: Number(dayOfMonth) || 1, ...(startsFrom ? { startsFrom } : {}) }
      : { type, anchor: anchor || todayIso };

  const schedule = [{ from: from || todayIso, amount: amount || "0" }];

  // Calculations for Live HUD Preview
  const numericAmount = parseFloat(amount || "0");
  const annualCost = useMemo(() => {
    if (numericAmount <= 0) return 0;
    switch (type) {
      case "MONTHLY":
        return numericAmount * 12;
      case "BIWEEKLY":
        return numericAmount * 26;
      case "QUARTERLY":
        return numericAmount * 4;
      case "ANNUAL":
        return numericAmount;
      default:
        return numericAmount * 12;
    }
  }, [numericAmount, type]);

  const monthlyEquivalent = useMemo(() => {
    if (annualCost <= 0) return 0;
    return annualCost / 12;
  }, [annualCost]);

  // Projected next 3 payment dates
  const next3PaymentDates = useMemo(() => {
    const dates: string[] = [];
    const baseDateStr = type === "MONTHLY" ? startsFrom || from || todayIso : anchor || from || todayIso;
    const baseDate = new Date(`${baseDateStr}T12:00:00Z`);

    if (isNaN(baseDate.getTime())) return dates;

    for (let i = 0; i < 3; i++) {
      const d = new Date(baseDate);
      if (type === "MONTHLY") {
        const dom = parseInt(dayOfMonth, 10) || 1;
        d.setUTCMonth(d.getUTCMonth() + i);
        d.setUTCDate(Math.min(dom, 28)); // Safe day
      } else if (type === "BIWEEKLY") {
        d.setUTCDate(d.getUTCDate() + i * 14);
      } else if (type === "QUARTERLY") {
        d.setUTCMonth(d.getUTCMonth() + i * 3);
      } else if (type === "ANNUAL") {
        d.setUTCFullYear(d.getUTCFullYear() + i);
      }
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }, [type, startsFrom, from, todayIso, anchor, dayOfMonth]);

  const handleApplyTaxAmount = (newAmountStr: string, calculationNote?: string) => {
    setAmount(newAmountStr);
    if (calculationNote) {
      setNotes((prev) => {
        if (!prev) return calculationNote;
        if (prev.includes("Base:") || prev.includes("Total:")) return prev;
        return `${prev} · ${calculationNote}`;
      });
    }
  };

  const handleStartsFromChange = (newStartsFrom: string) => {
    setStartsFrom(newStartsFrom);
    if (newStartsFrom) {
      const parts = newStartsFrom.split("-");
      if (parts.length === 3) {
        const day = parseInt(parts[2], 10);
        if (day >= 1 && day <= 31) {
          setDayOfMonth(String(day));
        }
      }
      if (type !== "MONTHLY") {
        setAnchor(newStartsFrom);
      }
    }
  };

  return (
    <div className="space-y-6">
      <input type="hidden" name="cadenceJson" value={JSON.stringify(cadence)} />
      <input type="hidden" name="scheduleJson" value={JSON.stringify(schedule)} />

      {/* SECTION 1: Basic Information */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
          <Receipt className="size-4 text-primary" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Basic Bill Information
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="bill-name">
              Bill Name <span className="text-red-500">*</span>
            </label>
            <input
              id="bill-name"
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pickleball Membership, Hydro"
              className={input}
            />
          </div>

          <div>
            <label className={label} htmlFor="bill-category">
              Category
            </label>
            <select
              id="bill-category"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={input}
            >
              <option value="housing">Housing</option>
              <option value="utilities">Utilities</option>
              <option value="subscriptions">Subscriptions</option>
              <option value="transport">Transport</option>
              <option value="debt">Debt</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className={label} htmlFor="bill-payee">
              Payee / Merchant (optional)
            </label>
            <input
              id="bill-payee"
              name="payee"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="e.g. Pickleplex Oshawa, Toronto Hydro"
              className={input}
            />
          </div>

          <div>
            <label className={label} htmlFor="bill-currency">
              Currency
            </label>
            <select
              id="bill-currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={input}
            >
              <option value="CAD">CAD ($) — Canadian Dollar</option>
              <option value="USD">USD ($) — US Dollar</option>
              <option value="JMD">JMD ($) — Jamaican Dollar</option>
            </select>
          </div>
        </div>

        {/* Smart Payee Suggestion Chip */}
        {activeSuggestion ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs text-foreground animate-fadeIn">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary shrink-0" />
              <span>
                Detected <strong>{activeSuggestion.reason}</strong>: suggest category{" "}
                <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                  {activeSuggestion.category}
                </Badge>
                {activeSuggestion.spendCategory ? (
                  <>
                    {" "}
                    &amp; spend category{" "}
                    <Badge variant="secondary" className="text-[10px] font-semibold">
                      {activeSuggestion.spendCategory}
                    </Badge>
                  </>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              onClick={() => applySuggestion(activeSuggestion)}
              className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shadow-2xs"
            >
              Apply suggestion
            </button>
          </div>
        ) : null}
      </div>

      {/* SECTION 2: Card & Payment Optimization */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
          <CreditCard className="size-4 text-primary" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Payment Method &amp; Rewards Category
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="bill-spend-category">
              Spend Category (Reward Multiplier Mapping)
            </label>
            <select
              id="bill-spend-category"
              name="spendCategory"
              value={spendCategory}
              onChange={(e) => setSpendCategory(e.target.value)}
              className={input}
            >
              <option value="">Auto (derived from General Category)</option>
              {spendCategoryOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pin the specific reward category (e.g. &quot;Memberships&quot; vs. &quot;Streaming&quot;) so Card
              Copilot recommends the card that earns maximum points/cashback.
            </p>
          </div>

          <div className={paymentRail === "card_via_third_party" ? "" : "sm:col-span-2"}>
            <label className={label} htmlFor="bill-payment-rail">
              How it can be paid
            </label>
            <select
              id="bill-payment-rail"
              name="paymentRail"
              value={paymentRail}
              onChange={(e) => setPaymentRail(e.target.value)}
              className={input}
            >
              <option value="unknown">Not sure yet (Auto)</option>
              <option value="card">Credit card accepted directly (No fee)</option>
              <option value="pad">Bank account only (Pre-authorized debit / Bill pay)</option>
              <option value="card_via_third_party">Card only via third-party service (Surcharge fee)</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Guarantees honest card recommendations — avoids suggesting credit cards for accounts (like
              property taxes) that only take direct bank debit.
            </p>
          </div>

          {paymentRail === "card_via_third_party" ? (
            <div>
              <label className={label} htmlFor="bill-rail-fee-pct">
                Service fee (%)
              </label>
              <input
                id="bill-rail-fee-pct"
                name="railFeePct"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={railFeePct}
                onChange={(e) => setRailFeePct(e.target.value)}
                placeholder="e.g. 2.5"
                className={input}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Card Copilot compares this fee against card rewards to ensure you never lose money.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* SECTION 3: Schedule, Amount & Recurrence */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Schedule &amp; Cadence
            </h2>
          </div>
          <Badge variant="outline" className="text-[11px] font-semibold capitalize">
            {type.toLowerCase()} recurrence
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="bill-cadence">
              Cadence / Frequency
            </label>
            <select
              id="bill-cadence"
              value={type}
              onChange={(e) => {
                const nextType = e.target.value;
                setType(nextType);
                if (nextType !== "MONTHLY" && !anchor) {
                  setAnchor(startsFrom || from || todayIso);
                }
              }}
              className={input}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="BIWEEKLY">Biweekly (Every 14 days)</option>
              <option value="QUARTERLY">Quarterly (Every 3 months)</option>
              <option value="ANNUAL">Annual (Once a year)</option>
            </select>
          </div>

          {type === "MONTHLY" ? (
            <>
              <div>
                <label className={label} htmlFor="bill-day-of-month">
                  Day of Month (1–31)
                </label>
                <input
                  id="bill-day-of-month"
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className={input}
                />
              </div>

              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-foreground" htmlFor="bill-starts-from">
                    Starts from (optional)
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleStartsFromChange(getFirstOfCurrentMonth())}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                    >
                      1st of this month
                    </button>
                    <span className="text-muted-foreground text-[10px]">·</span>
                    <button
                      type="button"
                      onClick={() => handleStartsFromChange(getFirstOfNextMonth())}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                    >
                      1st of next month
                    </button>
                  </div>
                </div>
                <input
                  id="bill-starts-from"
                  type="date"
                  value={startsFrom}
                  onChange={(e) => handleStartsFromChange(e.target.value)}
                  className={input}
                />
              </div>
            </>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-foreground" htmlFor="bill-anchor">
                  Anchor Date (Known Payment Date) <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setAnchor(todayIso)}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                >
                  Today
                </button>
              </div>
              <input
                id="bill-anchor"
                type="date"
                required
                value={anchor}
                onChange={(e) => setAnchor(e.target.value)}
                className={input}
              />
            </div>
          )}
        </div>

        {/* Amount & Tax Calculator Row */}
        <div className="border-t border-border/60 pt-4 space-y-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-foreground" htmlFor="bill-amount">
                  Amount ({currency} $) <span className="text-red-500">*</span>
                </label>
                <span className="text-[10px] text-muted-foreground">Total invoiced per cadence</span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2 text-xs font-semibold text-muted-foreground">
                  $
                </span>
                <input
                  id="bill-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={amount}
                  placeholder="e.g. 98.95"
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${input} pl-7 font-mono font-medium`}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-foreground" htmlFor="bill-amount-from">
                  Amount effective from <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setFrom(todayIso)}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    Today
                  </button>
                  <span className="text-muted-foreground text-[10px]">·</span>
                  <button
                    type="button"
                    onClick={() => setFrom(getFirstOfCurrentMonth())}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline cursor-pointer"
                  >
                    1st of month
                  </button>
                </div>
              </div>
              <input
                id="bill-amount-from"
                type="date"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={input}
              />
            </div>
          </div>

          {/* Integrated Interactive Sales Tax Calculator */}
          <TaxCalculator
            currentAmount={amount}
            currency={currency}
            onApplyAmount={handleApplyTaxAmount}
          />
        </div>
      </div>

      {/* SECTION 4: Live Cashflow & Cadence Preview HUD */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-primary/15 pb-2.5">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
              Live Cashflow &amp; Forecast Preview
            </h2>
          </div>
          <Badge variant="secondary" className="text-[11px] font-semibold">
            {currency} Forecast
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="rounded-lg bg-card p-2.5 border border-border/80 shadow-2xs">
            <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
              Monthly Impact
            </span>
            <span className="mt-0.5 block font-mono text-base font-bold text-foreground">
              ${monthlyEquivalent.toFixed(2)}
            </span>
          </div>

          <div className="rounded-lg bg-card p-2.5 border border-border/80 shadow-2xs">
            <span className="block text-[10px] uppercase font-semibold text-muted-foreground">
              Annual Total
            </span>
            <span className="mt-0.5 block font-mono text-base font-bold text-primary">
              ${annualCost.toFixed(2)}
            </span>
          </div>

          <div className="col-span-2 rounded-lg bg-card p-2.5 border border-border/80 shadow-2xs text-left">
            <span className="block text-[10px] uppercase font-semibold text-muted-foreground mb-1 flex items-center gap-1">
              <CalendarDays className="size-3" />
              Next 3 Scheduled Payment Dates:
            </span>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs font-medium text-foreground">
              {next3PaymentDates.length > 0 ? (
                next3PaymentDates.map((d, idx) => (
                  <Badge key={d} variant="outline" className="text-[11px] font-mono">
                    #{idx + 1}: {d}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">Enter date parameters above</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 5: Tracking & Automation Preferences */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Autopay Toggle Card */}
        <label
          className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-all ${
            autopay
              ? "border-primary/50 bg-primary/5 text-foreground shadow-2xs"
              : "border-border/80 bg-muted/20 text-muted-foreground hover:bg-muted/40"
          }`}
        >
          <input
            type="checkbox"
            name="autopay"
            value="true"
            checked={autopay}
            onChange={(e) => setAutopay(e.target.checked)}
            className="mt-0.5 size-4 rounded accent-primary cursor-pointer"
          />
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Zap className={`size-3.5 ${autopay ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
              <span className="text-xs font-semibold text-foreground">Autopay Enabled</span>
            </div>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Bill is automatically debited from card/bank. Marked as safe from manual late fees.
            </p>
          </div>
        </label>

        {/* Variable Amount Toggle Card */}
        <label
          className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-all ${
            variable
              ? "border-primary/50 bg-primary/5 text-foreground shadow-2xs"
              : "border-border/80 bg-muted/20 text-muted-foreground hover:bg-muted/40"
          }`}
        >
          <input
            type="checkbox"
            name="variable"
            value="true"
            checked={variable}
            onChange={(e) => setVariable(e.target.checked)}
            className="mt-0.5 size-4 rounded accent-primary cursor-pointer"
          />
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="size-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">Variable Invoiced Amount</span>
            </div>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Amount fluctuates monthly (e.g. utilities). Prompts for exact invoice when marking paid.
            </p>
          </div>
        </label>
      </div>

      {/* SECTION 6: Notes & Metadata */}
      <div>
        <label className={label} htmlFor="bill-notes">
          Notes (optional)
        </label>
        <input
          id="bill-notes"
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Account numbers, portal links, tax notes, discount expiry..."
          className={input}
        />
      </div>
    </div>
  );
}
