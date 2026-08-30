"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Eye,
  EyeOff,
  Globe2,
  Landmark,
  LockKeyhole,
  PlusCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { TaxCalculator } from "@/components/bills/tax-calculator";
import { SmartRewardRouter } from "@/components/bills/smart-reward-router";
import { Badge } from "@/components/ui/badge";
import { createBill } from "@/app/bills/actions";
import type { BillRouteWalletCard } from "@/engine/billRouteScorer";
import { findKnownService } from "@/lib/domain/bills/serviceDirectory";
import {
  BILL_PARENT_CATEGORIES,
  resolveBillTaxonomy,
} from "@/lib/taxonomy/billTaxonomy";

export interface SpendCategoryOption {
  value: string;
  label: string;
}

interface SavedCardOption {
  id: string;
  nickname: string;
  lastFour: string | null;
}

interface BankAccountOption {
  id: string;
  name: string;
  institution: string;
  type: string;
}

interface VerifiedBillerResult {
  ccin: string;
  shortName: string;
  status: "ACTIVE" | "INACTIVE" | "DELETED" | "PENDING";
  province: string | null;
  country: string | null;
  acceptsElectronic: boolean;
  environment: "sandbox" | "production";
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
    reason: "Digital Media & Streaming",
  },
  // Subscriptions: Software / SaaS
  {
    pattern: /openai|chatgpt|claude|anthropic|github|gitlab|adobe|figma|notion|slack|zoom|aws|google cloud|digitalocean|cursor|1password|dropbox|icloud|jetbrains/i,
    category: "subscriptions:software_saas",
    spendCategory: "digitalMedia",
    paymentRail: "card",
    reason: "SaaS & Cloud Software",
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
    reason: "News & Media Publication",
  },
  // Utilities: Energy & Hydro
  {
    pattern: /hydro|enbridge|power|electric|gas|epcor|alecta|toronto hydro|bc hydro|hydro québec|enmax|fortis/i,
    category: "utilities:electricity_hydro",
    spendCategory: "householdUtilities",
    paymentRail: "card",
    reason: "Municipal Electricity & Energy",
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

const CADENCE_OPTIONS = [
  { value: "MONTHLY", label: "Monthly", period: "/mo" },
  { value: "WEEKLY", label: "Weekly", period: "/wk" },
  { value: "BIWEEKLY", label: "Biweekly", period: "/2wk" },
  { value: "QUARTERLY", label: "Quarterly", period: "/qtr" },
  { value: "ANNUAL", label: "Annual", period: "/yr" },
] as const;

export function BillFormFields({
  spendCategoryOptions,
  routeWalletCards,
  savedCards,
  bankAccounts,
  initialError,
}: {
  spendCategoryOptions: SpendCategoryOption[];
  routeWalletCards: BillRouteWalletCard[];
  savedCards: SavedCardOption[];
  bankAccounts: BankAccountOption[];
  initialError?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const todayIso = useMemo(() => getISODateToday(), []);

  // Form State
  const [payee, setPayee] = useState("");
  const [name, setName] = useState("");
  const [showCustomNickname, setShowCustomNickname] = useState(false);
  const [category, setCategory] = useState("utilities:electricity_hydro");
  const [currency, setCurrency] = useState("CAD");
  const [amount, setAmount] = useState("");
  const from = todayIso;

  // Cadence State
  const [type, setType] = useState<string>("MONTHLY");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startsFrom, setStartsFrom] = useState("");
  const [anchor, setAnchor] = useState(todayIso);

  // Payment Method & Routing State
  const [spendCategory, setSpendCategory] = useState("");
  const [paymentRail, setPaymentRail] = useState("unknown");
  const [railFeePct, setRailFeePct] = useState("");
  const [paymentSource, setPaymentSource] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");

  // Account Details & Links
  const [accountNumber, setAccountNumber] = useState("");
  const [showAccountNumber, setShowAccountNumber] = useState(false);
  const [accountNumberLabel, setAccountNumberLabel] = useState("Account / Customer #");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [credentialLocation, setCredentialLocation] = useState("");
  const [serviceUrl, setServiceUrl] = useState("");
  const [billingUrl, setBillingUrl] = useState("");
  const [cancellationUrl, setCancellationUrl] = useState("");

  // Verified Biller & Service state
  const [billerKind, setBillerKind] = useState<"REGISTERED_BILLER" | "SERVICE" | "CUSTOM">("CUSTOM");
  const [paymentsCanadaCcin, setPaymentsCanadaCcin] = useState("");
  const [selectedBiller, setSelectedBiller] = useState<VerifiedBillerResult | null>(null);
  const [billerResults, setBillerResults] = useState<VerifiedBillerResult[]>([]);
  const [billerSearchState, setBillerSearchState] = useState<"idle" | "loading" | "error">("idle");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Preferences & Notes
  const [autopay, setAutopay] = useState(false);
  const [variable, setVariable] = useState(false);
  const [notes, setNotes] = useState("");
  const [showTaxCalculator, setShowTaxCalculator] = useState(false);

  // Submission / Error state
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError ?? null);
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({});

  // Active suggestions
  const activeSuggestion = findPayeeSuggestion(name || payee, payee || name, category, spendCategory);
  const knownService = findKnownService(name || payee, payee || name);

  // Close dropdown on click outside or escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Search Payments Canada verified billers with debounce
  useEffect(() => {
    const query = payee.trim();
    if (query.length < 2 || selectedBiller?.shortName === query || knownService) {
      setBillerResults([]);
      setBillerSearchState("idle");
      setIsDropdownOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBillerSearchState("loading");
      try {
        const response = await fetch(`/api/billers/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("lookup failed");
        const body = (await response.json()) as { billers?: VerifiedBillerResult[] };
        const results = body.billers ?? [];
        setBillerResults(results);
        setIsDropdownOpen(results.length > 0);
        setBillerSearchState("idle");
      } catch {
        if (controller.signal.aborted) return;
        setBillerResults([]);
        setIsDropdownOpen(false);
        setBillerSearchState("error");
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [knownService, payee, selectedBiller]);

  const applySuggestion = (suggestion: PayeeSuggestion) => {
    setCategory(suggestion.category);
    if (suggestion.spendCategory) {
      setSpendCategory(suggestion.spendCategory);
    }
    if (suggestion.paymentRail && suggestion.paymentRail !== "unknown") {
      setPaymentRail(suggestion.paymentRail);
    }
  };

  const applyKnownService = () => {
    if (!knownService) return;
    const prev = payee;
    setPayee(knownService.displayName);
    if (!name || name === prev) setName(knownService.displayName);
    setCategory(knownService.category);
    setSpendCategory(knownService.spendCategory);
    setPaymentRail(knownService.paymentRail);
    setServiceUrl(knownService.serviceUrl);
    setBillerKind("SERVICE");
    setPaymentsCanadaCcin("");
    setSelectedBiller(null);
    setBillerResults([]);
    setIsDropdownOpen(false);
  };

  const applyVerifiedBiller = (biller: VerifiedBillerResult) => {
    const prev = payee;
    setPayee(biller.shortName);
    if (!name || name === prev) setName(biller.shortName);
    setBillerKind("REGISTERED_BILLER");
    setPaymentsCanadaCcin(biller.ccin);
    setSelectedBiller(biller);
    setBillerResults([]);
    setIsDropdownOpen(false);
  };

  const clearVerifiedBiller = () => {
    setSelectedBiller(null);
    setPaymentsCanadaCcin("");
    setBillerKind("CUSTOM");
  };

  // Schedule & Cadence JSON
  const cadence =
    type === "MONTHLY"
      ? { type, dayOfMonth: Number(dayOfMonth) || 1, ...(startsFrom ? { startsFrom } : {}) }
      : { type, anchor: anchor || todayIso };

  const schedule = [{ from: from || todayIso, amount: amount || "0" }];

  // Calculations for live forecast HUD
  const numericAmount = parseFloat(amount || "0");
  const annualCost = useMemo(() => {
    if (numericAmount <= 0) return 0;
    switch (type) {
      case "MONTHLY":
        return numericAmount * 12;
      case "WEEKLY":
        return numericAmount * 52;
      case "BIWEEKLY":
        return numericAmount * 26;
      case "QUARTERLY":
        return numericAmount * 4;
      case "SEMIANNUAL":
        return numericAmount * 2;
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
    const dates: Array<{ date: string; relative: string }> = [];
    const baseDateStr = type === "MONTHLY" ? startsFrom || from || todayIso : anchor || from || todayIso;
    const baseDate = new Date(`${baseDateStr}T12:00:00Z`);

    if (isNaN(baseDate.getTime())) return dates;

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let i = 0; i < 3; i++) {
      const d = new Date(baseDate);
      if (type === "MONTHLY") {
        const dom = parseInt(dayOfMonth, 10) || 1;
        d.setUTCMonth(d.getUTCMonth() + i);
        d.setUTCDate(Math.min(dom, 28));
      } else if (type === "WEEKLY") {
        d.setUTCDate(d.getUTCDate() + i * 7);
      } else if (type === "BIWEEKLY") {
        d.setUTCDate(d.getUTCDate() + i * 14);
      } else if (type === "QUARTERLY") {
        d.setUTCMonth(d.getUTCMonth() + i * 3);
      } else if (type === "ANNUAL") {
        d.setUTCFullYear(d.getUTCFullYear() + i);
      }

      const iso = d.toISOString().slice(0, 10);
      const targetDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const diffDays = Math.ceil((targetDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
      
      let relative = "";
      if (diffDays === 0) relative = "Today";
      else if (diffDays === 1) relative = "Tomorrow";
      else if (diffDays > 1 && diffDays <= 60) relative = `in ${diffDays}d`;
      else relative = "";

      dates.push({ date: iso, relative });
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

  // Client-Side Submission with Zero Data Loss
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});

    const billPayee = payee.trim();
    const billName = (name.trim() || billPayee);

    // Client-side quick checks
    if (!billPayee && !billName) {
      setErrorMessage("Please enter a payee or company name.");
      setFieldErrors({ payee: "Company or payee name is required." });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setErrorMessage("Please enter a valid bill amount (greater than $0.00).");
      setFieldErrors({ amount: "Amount must be greater than $0.00" });
      return;
    }

    const formData = new FormData();
    formData.set("name", billName);
    formData.set("payee", billPayee);
    formData.set("category", category);
    formData.set("currency", currency);
    formData.set("cadenceJson", JSON.stringify(cadence));
    formData.set("scheduleJson", JSON.stringify(schedule));
    formData.set("billerKind", billerKind);
    formData.set("paymentsCanadaCcin", paymentsCanadaCcin);
    formData.set("autopay", autopay ? "true" : "false");
    formData.set("variable", variable ? "true" : "false");

    if (spendCategory) formData.set("spendCategory", spendCategory);
    if (paymentRail) formData.set("paymentRail", paymentRail);
    if (railFeePct) formData.set("railFeePct", railFeePct);
    if (paymentSource) formData.set("paymentSource", paymentSource);
    if (selectedRouteId) formData.set("selectedRouteId", selectedRouteId);
    if (accountNumber) formData.set("accountNumber", accountNumber);
    if (accountNumberLabel) formData.set("accountNumberLabel", accountNumberLabel);
    if (loginIdentifier) formData.set("loginIdentifier", loginIdentifier);
    if (credentialLocation) formData.set("credentialLocation", credentialLocation);
    if (serviceUrl) formData.set("serviceUrl", serviceUrl);
    if (billingUrl) formData.set("billingUrl", billingUrl);
    if (cancellationUrl) formData.set("cancellationUrl", cancellationUrl);
    if (notes) formData.set("notes", notes);

    startTransition(async () => {
      const result = await createBill(formData);
      if (result.ok) {
        router.push("/bills");
        router.refresh();
      } else {
        setErrorMessage(result.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ERROR ALERT (Retains full form state) */}
      {errorMessage ? (
        <div
          className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-medium text-destructive transition-all animate-fadeIn shadow-xs"
          role="alert"
        >
          <AlertCircle className="size-5 shrink-0 text-destructive mt-0.5" />
          <div className="space-y-1 flex-1">
            <p className="font-semibold">Unable to save bill</p>
            <p className="text-xs text-destructive/90">{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-destructive/70 hover:text-destructive text-xs"
            aria-label="Dismiss error"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {/* 1. HERO BILLER & AMOUNT SECTION */}
      <div className="rounded-3xl border border-border/80 bg-card/90 backdrop-blur-md p-5 sm:p-7 shadow-xs space-y-6 transition-all">
        {/* Omni Payee Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="bill-payee">
              Company, Payee or Service <span className="text-destructive">*</span>
            </label>
            {selectedBiller ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="size-3" /> Verified Biller
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">Type any custom name or search verified</span>
            )}
          </div>

          <div ref={searchContainerRef} className="relative">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-4 size-4 text-muted-foreground" />
              <input
                id="bill-payee"
                name="payee"
                required
                autoComplete="organization"
                value={payee}
                onChange={(e) => {
                  const val = e.target.value;
                  setPayee(val);
                  if (selectedBiller) clearVerifiedBiller();
                  if (!name || name === payee) setName(val);
                }}
                onFocus={() => {
                  if (billerResults.length > 0) setIsDropdownOpen(true);
                }}
                placeholder="Search Toronto Hydro, Netflix, Landlord, Gym..."
                className={`flex h-12 w-full rounded-2xl border bg-background/80 pl-11 pr-24 text-base font-medium shadow-2xs transition-all placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary ${
                  fieldErrors.payee ? "border-destructive ring-1 ring-destructive" : "border-input hover:border-border"
                }`}
              />
              <div className="absolute right-3.5 flex items-center gap-1.5">
                {billerSearchState === "loading" ? (
                  <span className="text-[11px] font-medium text-muted-foreground animate-pulse">Searching…</span>
                ) : payee.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPayee("");
                      setName("");
                      clearVerifiedBiller();
                    }}
                    className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    title="Clear"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Verified Biller Match Pill */}
            {selectedBiller ? (
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-300 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    <strong>{selectedBiller.shortName}</strong> · Payments Canada CCIN {selectedBiller.ccin}
                    {selectedBiller.province ? ` (${selectedBiller.province})` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearVerifiedBiller}
                  className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 underline underline-offset-2 hover:opacity-80 cursor-pointer"
                >
                  Use custom entry
                </button>
              </div>
            ) : null}

            {/* Verified Biller Autocomplete Dropdown */}
            {isDropdownOpen && billerResults.length > 0 ? (
              <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-2xl border border-border/80 bg-popover/95 backdrop-blur-xl shadow-xl animate-fadeIn">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Payments Canada Registered Billers</span>
                  <span className="text-[10px] text-muted-foreground/80 font-normal">Esc to close</span>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {billerResults.map((biller) => (
                    <button
                      key={biller.ccin}
                      type="button"
                      disabled={biller.status !== "ACTIVE"}
                      onClick={() => applyVerifiedBiller(biller)}
                      className="flex w-full items-center justify-between gap-3 border-b border-border/40 px-4 py-3 text-left last:border-b-0 hover:bg-muted/60 transition-colors disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    >
                      <div className="space-y-0.5">
                        <span className="block text-sm font-semibold text-foreground">{biller.shortName}</span>
                        <span className="block text-xs text-muted-foreground font-mono">
                          CCIN {biller.ccin} {biller.province ? `· ${biller.province}` : ""}
                        </span>
                      </div>
                      <Badge variant={biller.status === "ACTIVE" ? "success" : "outline"} className="text-[10px] font-medium">
                        {biller.status.toLowerCase()}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {/* Recognized Digital Service Banner */}
          {knownService && billerKind !== "SERVICE" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3.5 py-2.5 text-xs text-foreground animate-fadeIn">
              <div className="flex items-center gap-2">
                <Globe2 className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
                <span>
                  Recognized <strong>{knownService.displayName}</strong> · Auto-link {new URL(knownService.serviceUrl).hostname}
                </span>
              </div>
              <button
                type="button"
                onClick={applyKnownService}
                className="rounded-lg border border-sky-500/30 bg-background/80 px-2.5 py-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer"
              >
                Apply details
              </button>
            </div>
          ) : null}

          {/* Payee Category Intelligence Chip */}
          {activeSuggestion ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs text-foreground animate-fadeIn">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary shrink-0" />
                <span>
                  Suggested category for <strong>{activeSuggestion.reason}</strong>:{" "}
                  <Badge variant="outline" className="text-[10px] font-semibold ml-1">
                    {resolveBillTaxonomy(activeSuggestion.category).formattedLabel}
                  </Badge>
                </span>
              </div>
              <button
                type="button"
                onClick={() => applySuggestion(activeSuggestion)}
                className="rounded-lg bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-2xs hover:bg-primary/90 transition-colors cursor-pointer"
              >
                Apply
              </button>
            </div>
          ) : null}

          {/* Custom Nickname Toggle */}
          <div className="pt-1">
            {!showCustomNickname ? (
              <button
                type="button"
                onClick={() => setShowCustomNickname(true)}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors cursor-pointer"
              >
                + Add distinct nickname / label
              </button>
            ) : (
              <div className="space-y-1 pt-1 animate-fadeIn">
                <label className="text-xs font-medium text-foreground" htmlFor="bill-name">
                  Custom Nickname / Display Label
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="bill-name"
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. My Phone, Master Bedroom Hydro"
                    className="flex h-9 w-full rounded-xl border border-input bg-background/80 px-3 py-1.5 text-sm shadow-2xs transition-all placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomNickname(false);
                      setName(payee);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* HERO AMOUNT DISPLAY */}
        <div className="border-t border-border/60 pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="bill-amount">
              Bill Amount &amp; Currency <span className="text-destructive">*</span>
            </label>
            <button
              type="button"
              onClick={() => setShowTaxCalculator((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
            >
              <SlidersHorizontal className="size-3" />
              <span>{showTaxCalculator ? "Hide Tax Calculator" : "Calculate Sales Tax (HST/GST)"}</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Big Hero Amount Input */}
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold font-mono text-muted-foreground">
                $
              </span>
              <input
                id="bill-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={`flex h-16 w-full rounded-2xl border bg-background/80 pl-10 pr-4 text-3xl font-bold font-mono tracking-tight shadow-2xs transition-all placeholder:text-muted-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  fieldErrors.amount ? "border-destructive ring-1 ring-destructive" : "border-input"
                }`}
              />
            </div>

            {/* Currency Selector Pill */}
            <div className="flex sm:w-44 items-center">
              <select
                id="bill-currency"
                name="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                aria-label="Currency"
                className="flex h-16 w-full rounded-2xl border border-input bg-muted/40 px-3.5 text-sm font-semibold text-foreground shadow-2xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
              >
                <option value="CAD">CAD ($) · Canada</option>
                <option value="USD">USD ($) · US Dollar</option>
                <option value="JMD">JMD ($) · Jamaica</option>
              </select>
            </div>
          </div>

          {/* Integrated Interactive Sales Tax Calculator */}
          {showTaxCalculator ? (
            <div className="rounded-2xl border border-border/80 bg-muted/20 p-4 animate-fadeIn">
              <TaxCalculator
                currentAmount={amount}
                currency={currency}
                onApplyAmount={handleApplyTaxAmount}
              />
            </div>
          ) : null}
        </div>

        {/* Category Selector */}
        <div className="border-t border-border/60 pt-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2" htmlFor="bill-category">
            Taxonomy &amp; Category
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
            className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm font-medium shadow-2xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
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
      </div>

      {/* 2. APPLE-GRADE SEGMENTED CADENCE & SCHEDULE */}
      <div className="rounded-3xl border border-border/80 bg-card/90 backdrop-blur-md p-5 sm:p-7 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cadence &amp; Frequency
            </h2>
          </div>
          <Badge variant="outline" className="text-[11px] font-semibold font-mono">
            {CADENCE_OPTIONS.find((o) => o.value === type)?.label ?? type}
          </Badge>
        </div>

        {/* Segmented Control Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 rounded-2xl bg-muted/40 p-1.5 border border-border/60">
          {CADENCE_OPTIONS.map((opt) => {
            const isSelected = type === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setType(opt.value);
                  if (opt.value !== "MONTHLY" && !anchor) {
                    setAnchor(startsFrom || from || todayIso);
                  }
                }}
                className={`flex flex-col items-center justify-center py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isSelected
                    ? "bg-background text-foreground shadow-xs scale-[1.01]"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                }`}
              >
                <span>{opt.label}</span>
                <span className="text-[10px] text-muted-foreground/80 font-normal font-mono">{opt.period}</span>
              </button>
            );
          })}
        </div>

        {/* Dynamic Cadence Parameters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {type === "MONTHLY" ? (
            <>
              <div>
                <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-day-of-month">
                  Day of Month (1–31)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="bill-day-of-month"
                    type="number"
                    min={1}
                    max={31}
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(e.target.value)}
                    className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm font-semibold font-mono shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setDayOfMonth("1")}
                      className="px-2.5 py-1.5 rounded-lg border border-border bg-muted/30 text-[11px] font-semibold hover:bg-muted cursor-pointer"
                    >
                      1st
                    </button>
                    <button
                      type="button"
                      onClick={() => setDayOfMonth("15")}
                      className="px-2.5 py-1.5 rounded-lg border border-border bg-muted/30 text-[11px] font-semibold hover:bg-muted cursor-pointer"
                    >
                      15th
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-foreground block" htmlFor="bill-starts-from">
                    Starts from (optional)
                  </label>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => handleStartsFromChange(getFirstOfCurrentMonth())}
                      className="hover:text-foreground underline cursor-pointer"
                    >
                      1st this mo
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => handleStartsFromChange(getFirstOfNextMonth())}
                      className="hover:text-foreground underline cursor-pointer"
                    >
                      1st next mo
                    </button>
                  </div>
                </div>
                <input
                  id="bill-starts-from"
                  type="date"
                  value={startsFrom}
                  onChange={(e) => handleStartsFromChange(e.target.value)}
                  className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm font-mono shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-foreground block" htmlFor="bill-anchor">
                  Anchor Date (Known Payment Date) <span className="text-destructive">*</span>
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
                className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm font-mono shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          )}
        </div>

        {/* LIVE FORECAST CAPSULE HUD */}
        <div className="rounded-2xl border border-primary/25 bg-primary/[0.04] p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                Live Forecast &amp; Cashflow Capsule
              </span>
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground font-mono">
              {currency} Projections
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-card p-3 border border-border/80 shadow-2xs">
              <span className="block text-[10px] uppercase font-bold text-muted-foreground">Monthly Impact</span>
              <span className="mt-1 block font-mono text-lg font-bold text-foreground">
                ${monthlyEquivalent.toFixed(2)}
              </span>
            </div>

            <div className="rounded-xl bg-card p-3 border border-border/80 shadow-2xs">
              <span className="block text-[10px] uppercase font-bold text-muted-foreground">Annual Total</span>
              <span className="mt-1 block font-mono text-lg font-bold text-primary">
                ${annualCost.toFixed(2)}
              </span>
            </div>

            <div className="col-span-2 rounded-xl bg-card p-3 border border-border/80 shadow-2xs flex flex-col justify-center">
              <span className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 flex items-center gap-1">
                <CalendarDays className="size-3" /> Next 3 Scheduled Payments:
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {next3PaymentDates.length > 0 ? (
                  next3PaymentDates.map((item, idx) => (
                    <Badge key={item.date} variant="outline" className="text-[10px] font-mono py-0.5">
                      #{idx + 1}: {item.date} {item.relative ? `(${item.relative})` : ""}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Enter date parameters above</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. PAYMENT METHOD & SMART REWARD ROUTER */}
      <div className="rounded-3xl border border-border/80 bg-card/90 backdrop-blur-md p-5 sm:p-7 shadow-xs space-y-5">
        <div className="flex items-center gap-2 border-b border-border/60 pb-3">
          <CreditCard className="size-4 text-primary" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Payment Method &amp; Card Optimization
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-payment-source">
              Current Payment Source
            </label>
            <div className="relative">
              <Landmark className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-muted-foreground" />
              <select
                id="bill-payment-source"
                name="paymentSource"
                value={paymentSource}
                onChange={(e) => {
                  const val = e.target.value;
                  setPaymentSource(val);
                  if (val.startsWith("card:")) setPaymentRail("card");
                  if (val.startsWith("account:")) setPaymentRail("pad");
                }}
                className="flex h-11 w-full rounded-xl border border-input bg-background/80 pl-10 pr-3.5 text-sm font-medium shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
              >
                <option value="">Not recorded yet</option>
                {savedCards.length > 0 ? (
                  <optgroup label="Cards in wallet">
                    {savedCards.map((card) => (
                      <option key={card.id} value={`card:${card.id}`}>
                        {card.nickname} {card.lastFour ? `· •••• ${card.lastFour}` : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {bankAccounts.length > 0 ? (
                  <optgroup label="Bank accounts">
                    {bankAccounts.map((account) => (
                      <option key={account.id} value={`account:${account.id}`}>
                        {account.institution} · {account.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Select what is currently charged. Card Copilot will optimize and recommend upgrades.
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-spend-category">
              Spend Category Override
            </label>
            <select
              id="bill-spend-category"
              name="spendCategory"
              value={spendCategory}
              onChange={(e) => setSpendCategory(e.target.value)}
              className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm font-medium shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
            >
              <option value="">Auto (derived from Category)</option>
              {spendCategoryOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-payment-rail">
              Accepted Payment Method
            </label>
            <select
              id="bill-payment-rail"
              name="paymentRail"
              value={paymentRail}
              onChange={(e) => setPaymentRail(e.target.value)}
              className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm font-medium shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
            >
              <option value="unknown">Not sure yet (Auto)</option>
              <option value="card">Credit Card accepted directly (No fee)</option>
              <option value="pad">Bank Account only (PAD / Direct Debit)</option>
              <option value="card_via_third_party">Card only via third-party service (Surcharge)</option>
            </select>
          </div>

          {paymentRail === "card_via_third_party" ? (
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-rail-fee-pct">
                Third-Party Surcharge Fee (%)
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
                placeholder="e.g. 2.50"
                className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm font-mono shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          ) : null}
        </div>

        {/* Smart Reward Router Integration */}
        {payee.trim() || name.trim() ? (
          <details className="group border-t border-border/60 pt-3">
            <summary className="flex items-center justify-between cursor-pointer text-xs font-semibold text-foreground py-1 select-none hover:text-primary">
              <span className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                <span>Compare alternative payment routes and reward multipliers</span>
              </span>
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="pt-3">
              <SmartRewardRouter
                payeeName={payee.trim() || name.trim()}
                monthlyCad={Number(amount) > 0 ? Number(amount) : 100}
                ownedCards={routeWalletCards}
                selectedRouteId={selectedRouteId}
                onSelectRoute={(route) => {
                  setSelectedRouteId(route.id);
                  setPaymentSource(route.walletCardId ? `card:${route.walletCardId}` : "");
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
          </details>
        ) : null}
      </div>

      {/* 4. PREFERENCES, VAULT & AUTOMATION */}
      <div className="rounded-3xl border border-border/80 bg-card/90 backdrop-blur-md p-5 sm:p-7 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <LockKeyhole className="size-4 text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Automation &amp; Encrypted Account Vault
            </h2>
          </div>
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="size-3.5" /> End-to-end Encrypted
          </span>
        </div>

        {/* Autopay & Variable Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label
            className={`flex items-start gap-3.5 rounded-2xl border p-4 cursor-pointer transition-all ${
              autopay
                ? "border-primary/50 bg-primary/5 text-foreground shadow-xs"
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
                <Zap className={`size-4 ${autopay ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
                <span className="text-sm font-semibold text-foreground">Autopay Enabled</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Bill is automatically charged to card/bank. Marked as safe from manual late fees.
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-3.5 rounded-2xl border p-4 cursor-pointer transition-all ${
              variable
                ? "border-primary/50 bg-primary/5 text-foreground shadow-xs"
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
                <SlidersHorizontal className="size-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Variable Invoiced Amount</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Amount fluctuates monthly (e.g. hydro). Prompts for exact invoice when marking paid.
              </p>
            </div>
          </label>
        </div>

        {/* Encrypted Account Identifier Details */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-account-number-label">
              Identifier Type
            </label>
            <input
              id="bill-account-number-label"
              name="accountNumberLabel"
              value={accountNumberLabel}
              onChange={(e) => setAccountNumberLabel(e.target.value)}
              placeholder="Account #, Policy #, Roll #"
              className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-account-number">
              Complete Account Number
            </label>
            <div className="relative">
              <input
                id="bill-account-number"
                name="accountNumber"
                type={showAccountNumber ? "text" : "password"}
                autoComplete="off"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="Stored encrypted and masked"
                className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 pr-11 text-sm font-mono shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowAccountNumber((prev) => !prev)}
                className="absolute right-2.5 top-2.5 inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                aria-label={showAccountNumber ? "Hide" : "Show"}
              >
                {showAccountNumber ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-login-identifier">
              Login Email / Username
            </label>
            <input
              id="bill-login-identifier"
              name="loginIdentifier"
              value={loginIdentifier}
              onChange={(e) => setLoginIdentifier(e.target.value)}
              placeholder="billing@example.com"
              autoComplete="username"
              className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-credential-location">
              Password Saved In
            </label>
            <input
              id="bill-credential-location"
              name="credentialLocation"
              value={credentialLocation}
              onChange={(e) => setCredentialLocation(e.target.value)}
              placeholder="iCloud Keychain, 1Password, Bitwarden…"
              className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-service-url">
              Company Portal / Login URL
            </label>
            <input
              id="bill-service-url"
              name="serviceUrl"
              value={serviceUrl}
              onChange={(e) => setServiceUrl(e.target.value)}
              placeholder="e.g. company.com/login (auto-prefixed https://)"
              className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm font-mono shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        {/* Separate URLs Expandable */}
        <details className="group border-t border-border/60 pt-3">
          <summary className="flex items-center justify-between cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground py-1 select-none">
            <span>Add separate billing and cancellation URLs</span>
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1" htmlFor="bill-billing-url">
                Billing URL
              </label>
              <input
                id="bill-billing-url"
                name="billingUrl"
                value={billingUrl}
                onChange={(e) => setBillingUrl(e.target.value)}
                placeholder="company.com/billing"
                className="flex h-9 w-full rounded-xl border border-input bg-background px-3 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1" htmlFor="bill-cancellation-url">
                Cancellation URL
              </label>
              <input
                id="bill-cancellation-url"
                name="cancellationUrl"
                value={cancellationUrl}
                onChange={(e) => setCancellationUrl(e.target.value)}
                placeholder="company.com/cancel"
                className="flex h-9 w-full rounded-xl border border-input bg-background px-3 text-xs font-mono"
              />
            </div>
          </div>
        </details>

        {/* Notes */}
        <div className="border-t border-border/60 pt-3">
          <label className="text-xs font-medium text-foreground block mb-1.5" htmlFor="bill-notes">
            Notes &amp; Reminders (optional)
          </label>
          <input
            id="bill-notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contract renewal dates, promo codes, tax deductible notes..."
            className="flex h-11 w-full rounded-xl border border-input bg-background/80 px-3.5 text-sm shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      </div>

      {/* 5. FLOATING BOTTOM SUBMIT ACTION BAR */}
      <div className="sticky bottom-4 z-20 rounded-2xl border border-border/80 bg-background/95 backdrop-blur-xl p-4 shadow-lg flex items-center justify-between gap-4">
        <Link
          href="/bills"
          className="text-xs font-semibold text-muted-foreground hover:text-foreground px-3 py-2 transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-6 text-sm font-semibold text-background shadow-sm hover:bg-foreground/90 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <>
              <div className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
              <span>Saving bill…</span>
            </>
          ) : (
            <>
              <PlusCircle className="size-4" />
              <span>Save Bill or Subscription</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
