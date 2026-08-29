"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  CalendarDays,
  CreditCard,
  Receipt,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { TaxCalculator } from "@/components/bills/tax-calculator";
import { SmartRewardRouter } from "@/components/bills/smart-reward-router";
import { Badge } from "@/components/ui/badge";
import type { BillRouteWalletCard } from "@/engine/billRouteScorer";
import {
  BILL_PARENT_CATEGORIES,
  resolveBillTaxonomy,
} from "@/lib/taxonomy/billTaxonomy";

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
  paymentRail?: "card" | "pad" | "card_via_third_party" | "unknown";
  reason: string;
}

const SMART_PAYEE_RULES: Array<{
  pattern: RegExp;
  category: string;
  spendCategory: string;
  paymentRail?: "card" | "pad" | "card_via_third_party" | "unknown";
  reason: string;
}> = [
  // Subscriptions: Gym & Fitness
  {
    pattern: /pickle|gym|fitness|sport|climb|goodlife|ymca|crossfit|f45|club|racquet|equinox|planet fitness|anytime/i,
    category: "subscriptions:gym_fitness",
    spendCategory: "memberships",
    paymentRail: "card",
    reason: "Fitness & Gym Membership",
  },
  // Subscriptions: Streaming
  {
    pattern: /netflix|spotify|disney|youtube|crave|hbo|paramount|prime video|apple tv|audible|crunchyroll/i,
    category: "subscriptions:streaming",
    spendCategory: "streaming",
    paymentRail: "card",
    reason: "Digital Media & Video/Audio Streaming",
  },
  // Subscriptions: Software / SaaS
  {
    pattern: /openai|chatgpt|claude|anthropic|github|gitlab|adobe|figma|notion|slack|zoom|aws|google cloud|digitalocean|cursor|1password|dropbox|icloud|jetbrains/i,
    category: "subscriptions:software_saas",
    spendCategory: "digitalMedia",
    paymentRail: "card",
    reason: "SaaS Software & Developer Tool",
  },
  // Subscriptions: Gaming
  {
    pattern: /playstation|xbox|nintendo|steam|ea play|game pass/i,
    category: "subscriptions:gaming",
    spendCategory: "digitalMedia",
    paymentRail: "card",
    reason: "Gaming Network Subscription",
  },
  // Subscriptions: News & Media
  {
    pattern: /nytimes|globe and mail|toronto star|wall street journal|wsj|the athletic|washington post/i,
    category: "subscriptions:news_media",
    spendCategory: "digitalMedia",
    paymentRail: "card",
    reason: "News & Publication Subscription",
  },
  // Utilities: Energy & Hydro
  {
    pattern: /hydro|enbridge|power|electric|gas|epcor|alecta|toronto hydro|bc hydro|hydro québec|enmax|fortis/i,
    category: "utilities:electricity_hydro",
    spendCategory: "householdUtilities",
    paymentRail: "card",
    reason: "Municipal Electricity & Energy Utility",
  },
  // Utilities: Water & Sewer
  {
    pattern: /water|sewer|durham water|toronto water|region of peel water|halton water/i,
    category: "utilities:water_sewer",
    spendCategory: "householdUtilities",
    paymentRail: "pad",
    reason: "Municipal Water & Sewer (PAD / Bill Pay)",
  },
  // Utilities: Mobile & Telecom
  {
    pattern: /rogers|bell|telus|fido|koodo|virgin|freedom|fizz|shaw|cogeco|chatr|public mobile|teksavvy|oxio|starlink/i,
    category: "utilities:mobile_phone",
    spendCategory: "householdUtilities",
    paymentRail: "card",
    reason: "Mobile & Home Internet Telecom",
  },
  // Transportation: Transit
  {
    pattern: /presto|ttc|go transit|compass|transit|stm|translink|brampton transit|miway|yrt/i,
    category: "transportation:transit",
    spendCategory: "transit",
    paymentRail: "card",
    reason: "Public Transit & Commuting",
  },
  // Transportation: Parking & Tolls
  {
    pattern: /407 etr|toll|ezpass|green p|precise parklink|impark|indigone/i,
    category: "transportation:tolls",
    spendCategory: "transit",
    paymentRail: "card",
    reason: "Highway Tolls & Transit Parking",
  },
  // Transportation: EV Charging
  {
    pattern: /tesla supercharg|flo|chargepoint|circuit electrique|ivy charging|electrify canada/i,
    category: "transportation:ev_charging",
    spendCategory: "evCharging",
    paymentRail: "card",
    reason: "EV Fast Charging Network",
  },
  // Insurance
  {
    pattern: /insurance|geico|intact|desjardins|aviva|td insurance|belair|sonnet|manulife|sun life|canada life|beneva|wawanesa/i,
    category: "insurance:auto",
    spendCategory: "recurring",
    paymentRail: "card",
    reason: "Insurance Coverage Policy",
  },
  // Housing: Rent
  {
    pattern: /rent|landlord|boardwalk|minto|capreit|chexy/i,
    category: "housing:rent",
    spendCategory: "",
    paymentRail: "pad",
    reason: "Residential Rent",
  },
  // Housing: Mortgage
  {
    pattern: /mortgage|scotiabank mortgage|td mortgage|rbc mortgage|bmo mortgage|cibc mortgage|first national|mcap/i,
    category: "housing:mortgage",
    spendCategory: "",
    paymentRail: "pad",
    reason: "Residential Mortgage",
  },
  // Housing: Property Tax
  {
    pattern: /property tax|city of toronto|city of mississauga|city of brampton|city of ottawa|region of durham tax|vaughan tax/i,
    category: "housing:property_tax",
    spendCategory: "",
    paymentRail: "pad",
    reason: "Municipal Property Taxes",
  },
  // Government: Income Tax
  {
    pattern: /cra|canada revenue|receiver general|revenu quebec|income tax/i,
    category: "government:income_tax",
    spendCategory: "",
    paymentRail: "pad",
    reason: "CRA / Provincial Income Taxes",
  },
  // Donations
  {
    pattern: /red cross|sickkids|sick kids|united way|salvation army|world wildlife|wwf|unicef|doctors without borders|msf|cancer society|heart & stroke|canadahelps/i,
    category: "donations:recurring",
    spendCategory: "recurring",
    paymentRail: "card",
    reason: "Charitable Non-Profit Donation",
  },
  // Education: Tuition
  {
    pattern: /university|college|uoft|uwaterloo|mcgill|ubc|york u|ryerson|tmu|seneca|george brown|humber|tuition/i,
    category: "education:tuition",
    spendCategory: "",
    paymentRail: "pad",
    reason: "Post-Secondary Tuition (Triangle 1% Eligible)",
  },
  // Debt: Student Loan
  {
    pattern: /osap|nslsc|student loan|national student loans/i,
    category: "debt:student_loan",
    spendCategory: "",
    paymentRail: "pad",
    reason: "Government Student Loan (Line 31900)",
  },
  // Education: Professional Dues
  {
    pattern: /cpa ontario|cpa canada|peo|law society|ona|ontario nurses|osstf|etfo|bcnu|professional dues/i,
    category: "education:professional_dues",
    spendCategory: "recurring",
    paymentRail: "card",
    reason: "Professional License & Union Dues",
  },
  // Health: Medical / Dental / Pharmacy
  {
    pattern: /dentist|dental|shoppers|rexall|pharmacy|pocketpills|physio|massage|rmt|therapy|psychotherapy/i,
    category: "health:medical",
    spendCategory: "drugStore",
    paymentRail: "card",
    reason: "Medical & Dental Healthcare (Line 33099)",
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
      if (category !== rule.category || (rule.spendCategory && spendCategory !== rule.spendCategory)) {
        return {
          category: rule.category,
          spendCategory: rule.spendCategory,
          paymentRail: rule.paymentRail,
          reason: rule.reason,
        };
      }
    }
  }
  return null;
}

export function BillFormFields({
  spendCategoryOptions,
  routeWalletCards,
}: {
  spendCategoryOptions: SpendCategoryOption[];
  routeWalletCards: BillRouteWalletCard[];
}) {
  const todayIso = useMemo(() => getISODateToday(), []);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("utilities:electricity_hydro");
  const [payee, setPayee] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
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
    if (suggestion.paymentRail && suggestion.paymentRail !== "unknown") {
      setPaymentRail(suggestion.paymentRail);
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

      {/* SECTION 1: Payee & Account Information */}
      <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-2xs space-y-4">
        <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
          <Receipt className="size-4 text-primary" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Payee &amp; Account Information
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="bill-payee">
              Payee Name <span className="text-red-500">*</span>
            </label>
            <input
              id="bill-payee"
              name="payee"
              required
              value={payee}
              onChange={(e) => {
                const val = e.target.value;
                setPayee(val);
                if (!name || name === payee) {
                  setName(val);
                }
              }}
              placeholder="e.g. DURHAM WATER, REG MUN OF, Toronto Hydro"
              className={input}
            />
          </div>

          <div>
            <label className={label} htmlFor="bill-account-number">
              Account Number
            </label>
            <input
              id="bill-account-number"
              name="accountNumber"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g. 1643208999, 5849-01-2"
              className={input}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Used for bill payment routing &amp; auto-matching statement receipts.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="bill-name">
              Bill / Payee Nickname
            </label>
            <input
              id="bill-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Durham Water, Home Utilities"
              className={input}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Friendly label shown across dashboards and calendar entries.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="bill-category">
              Bill Type / Category
            </label>
            <select
              id="bill-category"
              name="category"
              value={category}
              onChange={(e) => {
                const val = e.target.value;
                setCategory(val);
                const res = resolveBillTaxonomy(val);
                if (res.defaultPaymentRail && res.defaultPaymentRail !== "unknown") {
                  setPaymentRail(res.defaultPaymentRail);
                }
              }}
              className={input}
            >
              {BILL_PARENT_CATEGORIES.map((parent) => (
                <optgroup key={parent.id} label={`${parent.icon} ${parent.label}`}>
                  {parent.subcategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
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
                <Badge variant="outline" className="text-[10px] font-semibold">
                  {resolveBillTaxonomy(activeSuggestion.category).formattedLabel}
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

        {/* Smart Reward Router Integration */}
        {name.trim() || payee.trim() ? (
          <div className="pt-2">
            <SmartRewardRouter
              payeeName={payee.trim() || name.trim()}
              monthlyCad={Number(amount) > 0 ? Number(amount) : 0}
              ownedCards={routeWalletCards}
              onSelectRoute={(route) => {
                switch (route.intermediary.type) {
                  case "creditIntermediary":
                    setPaymentRail("card_via_third_party");
                    setRailFeePct(String(Math.round(route.intermediary.feeRate * 10_000) / 100));
                    break;
                  case "cardDirectBillPay":
                    setPaymentRail("card");
                    setRailFeePct("");
                    break;
                  case "fintechAccountRouting":
                  case "standardEft":
                    setPaymentRail("pad");
                    setRailFeePct("");
                    break;
                }
              }}
            />
          </div>
        ) : null}
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
