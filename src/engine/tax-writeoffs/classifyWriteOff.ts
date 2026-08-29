import { CRA_TAX_LINES, type CraTaxLineDef } from "./craTaxLines";

export interface WriteOffClassification {
  isCandidate: boolean;
  taxLineKey: string | null;
  taxLine: CraTaxLineDef | null;
  suggestedBusinessPct: number;
  confidence: "VERIFIED" | "LIKELY" | "SUGGESTED" | "NONE";
  rationale: string;
}

interface MatchRule {
  key: string;
  taxLineKey: keyof typeof CRA_TAX_LINES;
  confidence: "VERIFIED" | "LIKELY" | "SUGGESTED";
  pattern: RegExp;
  rationale: string;
  defaultPctOverride?: number;
}

const DEDUCTION_MATCH_RULES: MatchRule[] = [
  // 1. SaaS, AI, Cloud, Dev & Office Subscriptions (Form T2125 Line 8810)
  {
    key: "saas_ai_cloud",
    taxLineKey: "T2125_8810",
    confidence: "VERIFIED",
    pattern:
      /\b(openai|chatgpt|anthropic|claude|github|gitlab|aws|amazon web services|google cloud|gcp|digitalocean|vercel|supabase|cloudflare|adobe|figma|jetbrains|notion|slack|zoom|loom|webflow|cursor|1password|lastpass|microsoft 365|office 365|mailchimp|resend|postmark|sendgrid|stripe|zapier|make\.com|linear|jira|atlassian|postman|canva|datadog|sentry|heroku|replit|jetbrains|docker|render\.com|fly\.io|supabase)\b/i,
    rationale: "Software subscription, AI tool, or cloud hosting service for business operations.",
  },

  // 2. Advertising, Domains & Marketing (Form T2125 Line 8521)
  {
    key: "ads_domains",
    taxLineKey: "T2125_8521",
    confidence: "VERIFIED",
    pattern:
      /\b(google ads|meta ads|facebook ads|instagram ads|linkedin ads|twitter ads|x ads|tiktok ads|namecheap|godaddy|hover\.com|porkbun|domain\.com|squarespace|wix|convertkit|hubspot)\b/i,
    rationale: "Digital marketing, advertising, domain registration, or promotional platform.",
  },

  // 3. Telecom & Internet (Form T2125 Line 9281 / T777)
  {
    key: "telecom_internet",
    taxLineKey: "T2125_9281",
    confidence: "LIKELY",
    pattern:
      /\b(rogers|bell canada|bell mobility|telus|fido|koodo|freedom mobile|fizz|starlink|shaw cable|cogeco|chatr|public mobile|teksavvy|oxio)\b/i,
    rationale: "Mobile phone or home internet service (eligible for business / home-office allocation split).",
    defaultPctOverride: 50,
  },

  // 4. Home Utilities & Power (Form T2125 Line 9281 / T777)
  {
    key: "home_utilities",
    taxLineKey: "T2125_9281",
    confidence: "LIKELY",
    pattern:
      /\b(toronto hydro|hydro one|enbridge|bc hydro|hydro québec|hydro-québec|epcor|alecta|toronto water|enmax|fortis|power stream)\b/i,
    rationale: "Household energy/water utility (eligible for workspace square-footage deduction).",
    defaultPctOverride: 15,
  },

  // 5. Medical Expenses & Prescriptions (Personal T1 Line 33099)
  {
    key: "medical_health",
    taxLineKey: "PERSONAL_33099",
    confidence: "VERIFIED",
    pattern:
      /\b(shoppers drug mart|shoppers|rexall|jean coutu|pharmasave|ida pharmacy|guardian pharmacy|london drugs|lifelabs|dynacare|dental|dentist|orthodont|optometry|optometrist|lenscrafters|specsavers|physiotherapy|physio clinic|massage therapy|rmt clinic|psychotherapy|inkblot|wellin5|pocketpills)\b/i,
    rationale: "Prescription medication, dental care, vision, physiotherapy, or registered therapy.",
  },

  // 6. Registered Charitable Donations (Personal T1 Line 34900)
  {
    key: "charitable_donations",
    taxLineKey: "PERSONAL_34900",
    confidence: "VERIFIED",
    pattern:
      /\b(red cross|canadian red cross|sickkids|sick kids|united way|salvation army|world wildlife fund|wwf canada|unicef|doctors without borders|msf|cancer society|heart & stroke|heart and stroke|canadahelps|food bank|covenant house)\b/i,
    rationale: "Donation to a recognized CRA-registered charity.",
  },

  // 7. Annual Professional & Union Dues (Personal T1 Line 21200)
  {
    key: "professional_union_dues",
    taxLineKey: "PERSONAL_21200",
    confidence: "VERIFIED",
    pattern:
      /\b(cpa ontario|cpa canada|peo|professional engineers ontario|law society|ona|ontario nurses|osstf|oecta|etfo|bcnu|college of nurses|cpo|crpo)\b/i,
    rationale: "Statutory annual dues paid to a professional body or union required to maintain license.",
  },

  // 8. Business Travel & Lodging (Form T2125 Line 9200)
  {
    key: "travel_lodging",
    taxLineKey: "T2125_9200",
    confidence: "SUGGESTED",
    pattern:
      /\b(air canada|westjet|porter airlines|via rail|amtrak|enterprise rent|hertz|avis|budget rent|marriott|hilton|hyatt|sheraton|best western|holiday inn|airbnb)\b/i,
    rationale: "Airline, rail, car rental, or hotel booking (deductible when undertaken for business).",
  },
];

export interface ItemContext {
  merchant?: string | null;
  name?: string | null;
  category?: string | null;
  spendCategory?: string | null;
  notes?: string | null;
  items?: Array<{ title?: string | null }> | null;
}

/**
 * Evaluates whether an expense candidate qualifies for a CRA tax deduction.
 * Pure, deterministic, sub-millisecond execution with zero API cost.
 */
export function classifyWriteOff(context: ItemContext): WriteOffClassification {
  const combinedText = [
    context.merchant ?? "",
    context.name ?? "",
    context.category ?? "",
    context.spendCategory ?? "",
    context.notes ?? "",
    ...(context.items?.map((i) => i.title ?? "") ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!combinedText) {
    return {
      isCandidate: false,
      taxLineKey: null,
      taxLine: null,
      suggestedBusinessPct: 0,
      confidence: "NONE",
      rationale: "No merchant or category text provided.",
    };
  }

  for (const rule of DEDUCTION_MATCH_RULES) {
    if (rule.pattern.test(combinedText)) {
      const lineDef = CRA_TAX_LINES[rule.taxLineKey];
      return {
        isCandidate: true,
        taxLineKey: rule.taxLineKey,
        taxLine: lineDef,
        suggestedBusinessPct: rule.defaultPctOverride ?? lineDef.defaultBusinessPct,
        confidence: rule.confidence,
        rationale: rule.rationale,
      };
    }
  }

  return {
    isCandidate: false,
    taxLineKey: null,
    taxLine: null,
    suggestedBusinessPct: 0,
    confidence: "NONE",
    rationale: "Not identified as a standard CRA tax deduction category.",
  };
}
