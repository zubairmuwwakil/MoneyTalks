/**
 * Bill Taxonomy — Canadian Personal Finance & Household Bill Hierarchy.
 *
 * 13 Parent Categories, 54 Subcategories.
 *
 * Serves as the single source of truth for:
 * 1. UI Selection (<optgroup> hierarchy and badges).
 * 2. Card Reward Engine Mappings (spend category & representative MCC).
 * 3. Payment Rails & Intermediaries (Chexy, Triangle Bill Pay, PAD, Card).
 * 4. CRA Tax Deduction & Opportunity Triggers (T2125, T777, T2202, Lines 31900/33099/34900/21200).
 */

export interface BillSubcategoryDef {
  id: string;
  label: string;
  parentId: string;
  parentLabel: string;
  icon: string;
  defaultSpendCategory?: string | null;
  defaultPaymentRail?: "card" | "pad" | "card_via_third_party" | "unknown";
  isCardExcluded?: boolean;
  exclusionRationale?: string;
  craTaxSchedule?: {
    lineKey: string;
    form: string;
    line: string;
    name: string;
  };
  intermediaryTarget?: "chexy" | "triangle-bill-pay" | "standard-eft" | "neobanc";
}

export interface BillParentCategoryDef {
  id: string;
  label: string;
  icon: string;
  subcategories: BillSubcategoryDef[];
}

export const BILL_PARENT_CATEGORIES: BillParentCategoryDef[] = [
  {
    id: "housing",
    label: "Housing",
    icon: "🏠",
    subcategories: [
      {
        id: "housing:rent",
        label: "Rent",
        parentId: "housing",
        parentLabel: "Housing",
        icon: "🏠",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale:
          "Rent payments generally aren't directly chargeable to credit cards. Third-party portals (like Chexy) charge 1.75% transaction fees — recommendable only if paired with 4%+ recurring multipliers.",
        intermediaryTarget: "chexy",
        craTaxSchedule: {
          lineKey: "T2125_RENT",
          form: "T2125 / T777",
          line: "Workspace In Home",
          name: "Rent Allocation (Business / Remote Work Use)",
        },
      },
      {
        id: "housing:mortgage",
        label: "Mortgage",
        parentId: "housing",
        parentLabel: "Housing",
        icon: "🏡",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale:
          "Mortgage principal & interest payments cannot be charged to credit cards and clear exclusively via PAD / EFT.",
      },
      {
        id: "housing:condo_fees",
        label: "Condo / HOA Fees",
        parentId: "housing",
        parentLabel: "Housing",
        icon: "🏢",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Condo corporation and HOA dues are almost universally paid via pre-authorized debit.",
        intermediaryTarget: "chexy",
      },
      {
        id: "housing:property_tax",
        label: "Property Tax",
        parentId: "housing",
        parentLabel: "Housing",
        icon: "🏛️",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale:
          "Municipalities do not accept credit cards directly without 2.5%+ surcharges. Triangle Bill Pay earns 1.0% CT Money with 0% fee.",
        intermediaryTarget: "triangle-bill-pay",
        craTaxSchedule: {
          lineKey: "T2125_PROPERTY_TAX",
          form: "T2125 / T777",
          line: "9180",
          name: "Property Taxes (Home Office Portion)",
        },
      },
      {
        id: "housing:home_maintenance",
        label: "Home Maintenance",
        parentId: "housing",
        parentLabel: "Housing",
        icon: "🔧",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "utilities",
    label: "Utilities & Communications",
    icon: "⚡",
    subcategories: [
      {
        id: "utilities:electricity_hydro",
        label: "Electricity / Hydro",
        parentId: "utilities",
        parentLabel: "Utilities & Communications",
        icon: "💡",
        defaultSpendCategory: "householdUtilities",
        defaultPaymentRail: "card",
        intermediaryTarget: "triangle-bill-pay",
        craTaxSchedule: {
          lineKey: "T2125_9281",
          form: "T2125 / T777",
          line: "9281",
          name: "Utilities (Electricity/Hydro Workspace Split)",
        },
      },
      {
        id: "utilities:natural_gas",
        label: "Natural Gas",
        parentId: "utilities",
        parentLabel: "Utilities & Communications",
        icon: "🔥",
        defaultSpendCategory: "householdUtilities",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "T2125_9281",
          form: "T2125 / T777",
          line: "9281",
          name: "Utilities (Gas Heating Workspace Split)",
        },
      },
      {
        id: "utilities:water_sewer",
        label: "Water & Sewer",
        parentId: "utilities",
        parentLabel: "Utilities & Communications",
        icon: "💧",
        defaultSpendCategory: "householdUtilities",
        defaultPaymentRail: "pad",
        intermediaryTarget: "triangle-bill-pay",
        craTaxSchedule: {
          lineKey: "T2125_9281",
          form: "T2125 / T777",
          line: "9281",
          name: "Utilities (Water Utility Workspace Split)",
        },
      },
      {
        id: "utilities:waste",
        label: "Waste Management",
        parentId: "utilities",
        parentLabel: "Utilities & Communications",
        icon: "🗑️",
        defaultSpendCategory: "householdUtilities",
        defaultPaymentRail: "card",
      },
      {
        id: "utilities:mobile_phone",
        label: "Mobile Phone",
        parentId: "utilities",
        parentLabel: "Utilities & Communications",
        icon: "📱",
        defaultSpendCategory: "householdUtilities",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "T2125_9281",
          form: "T2125 / T777",
          line: "9281",
          name: "Telecommunications (Mobile Business Split)",
        },
      },
      {
        id: "utilities:internet",
        label: "Internet",
        parentId: "utilities",
        parentLabel: "Utilities & Communications",
        icon: "🌐",
        defaultSpendCategory: "householdUtilities",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "T2125_9281",
          form: "T2125 / T777",
          line: "9281",
          name: "Home Internet (Remote Work / Business Split)",
        },
      },
      {
        id: "utilities:home_phone",
        label: "Home Phone",
        parentId: "utilities",
        parentLabel: "Utilities & Communications",
        icon: "☎️",
        defaultSpendCategory: "householdUtilities",
        defaultPaymentRail: "card",
      },
      {
        id: "utilities:home_security",
        label: "Home Security",
        parentId: "utilities",
        parentLabel: "Utilities & Communications",
        icon: "🔒",
        defaultSpendCategory: "householdUtilities",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "insurance",
    label: "Insurance",
    icon: "🛡️",
    subcategories: [
      {
        id: "insurance:auto",
        label: "Auto Insurance",
        parentId: "insurance",
        parentLabel: "Insurance",
        icon: "🚗",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "T2125_9281_AUTO",
          form: "T2125",
          line: "9281",
          name: "Motor Vehicle Insurance (Business Mileage Split)",
        },
      },
      {
        id: "insurance:home_tenant",
        label: "Home / Tenant Insurance",
        parentId: "insurance",
        parentLabel: "Insurance",
        icon: "🛡️",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "T2125_HOME_INSURANCE",
          form: "T2125 / T777",
          line: "8690",
          name: "Home Insurance (Workspace In Home Split)",
        },
      },
      {
        id: "insurance:life",
        label: "Life Insurance",
        parentId: "insurance",
        parentLabel: "Insurance",
        icon: "❤️",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "pad",
      },
      {
        id: "insurance:health_dental",
        label: "Health & Dental Insurance",
        parentId: "insurance",
        parentLabel: "Insurance",
        icon: "🩺",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_33099",
          form: "T1 General",
          line: "33099",
          name: "Private Health Services Plan (PHSP) Premiums",
        },
      },
      {
        id: "insurance:travel",
        label: "Travel Insurance",
        parentId: "insurance",
        parentLabel: "Insurance",
        icon: "✈️",
        defaultSpendCategory: "travel",
        defaultPaymentRail: "card",
      },
      {
        id: "insurance:pet",
        label: "Pet Insurance",
        parentId: "insurance",
        parentLabel: "Insurance",
        icon: "🐾",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "transportation",
    label: "Transportation",
    icon: "🚗",
    subcategories: [
      {
        id: "transportation:transit",
        label: "Transit (Presto, TTC, Commuter)",
        parentId: "transportation",
        parentLabel: "Transportation",
        icon: "🚇",
        defaultSpendCategory: "transit",
        defaultPaymentRail: "card",
      },
      {
        id: "transportation:parking",
        label: "Parking",
        parentId: "transportation",
        parentLabel: "Transportation",
        icon: "🅿️",
        defaultSpendCategory: "transit",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "T2125_9281_PARKING",
          form: "T2125",
          line: "9281",
          name: "Business Parking Expense",
        },
      },
      {
        id: "transportation:tolls",
        label: "Tolls / Highway (e.g. 407 ETR)",
        parentId: "transportation",
        parentLabel: "Transportation",
        icon: "🛣️",
        defaultSpendCategory: "transit",
        defaultPaymentRail: "card",
      },
      {
        id: "transportation:auto_loan_lease",
        label: "Auto Loan / Lease",
        parentId: "transportation",
        parentLabel: "Transportation",
        icon: "🚘",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale:
          "Vehicle financing and leases clear through direct banking debit or dealership financing portals.",
        craTaxSchedule: {
          lineKey: "T2125_AUTO_LEASE",
          form: "T2125",
          line: "8910",
          name: "Motor Vehicle Lease / Interest (Business Pro-Rata)",
        },
      },
      {
        id: "transportation:ev_charging",
        label: "EV Charging",
        parentId: "transportation",
        parentLabel: "Transportation",
        icon: "🔌",
        defaultSpendCategory: "evCharging",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "debt",
    label: "Debt & Financing",
    icon: "💳",
    subcategories: [
      {
        id: "debt:credit_card",
        label: "Credit Card Payment",
        parentId: "debt",
        parentLabel: "Debt & Financing",
        icon: "💳",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Credit card bill payments clear via bank bill payment or PAD and do not earn card rewards.",
      },
      {
        id: "debt:line_of_credit",
        label: "Line of Credit",
        parentId: "debt",
        parentLabel: "Debt & Financing",
        icon: "📉",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Line of credit interest and payments clear exclusively via bank transfer / PAD.",
      },
      {
        id: "debt:personal_loan",
        label: "Personal Loan",
        parentId: "debt",
        parentLabel: "Debt & Financing",
        icon: "🏦",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Personal loan amortizations are non-chargeable to credit cards.",
      },
      {
        id: "debt:student_loan",
        label: "Student Loan",
        parentId: "debt",
        parentLabel: "Debt & Financing",
        icon: "🎓",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Government student loans (NSLSC / OSAP) clear via PAD or standard bank bill pay.",
        craTaxSchedule: {
          lineKey: "PERSONAL_31900",
          form: "T1 General",
          line: "31900",
          name: "Interest Paid on Student Loans (Claimable Tax Credit)",
        },
      },
      {
        id: "debt:bnpl_installment",
        label: "BNPL / Installment Plan",
        parentId: "debt",
        parentLabel: "Debt & Financing",
        icon: "🛍️",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "subscriptions",
    label: "Subscriptions & Memberships",
    icon: "📱",
    subcategories: [
      {
        id: "subscriptions:streaming",
        label: "Streaming (Video & Music)",
        parentId: "subscriptions",
        parentLabel: "Subscriptions & Memberships",
        icon: "🍿",
        defaultSpendCategory: "streaming",
        defaultPaymentRail: "card",
      },
      {
        id: "subscriptions:software_saas",
        label: "Software & SaaS",
        parentId: "subscriptions",
        parentLabel: "Subscriptions & Memberships",
        icon: "💻",
        defaultSpendCategory: "digitalMedia",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "T2125_8810",
          form: "T2125",
          line: "8810",
          name: "Office Software & SaaS Subscriptions (100% Business Deductible)",
        },
      },
      {
        id: "subscriptions:cloud_storage",
        label: "Cloud Storage & Hosting",
        parentId: "subscriptions",
        parentLabel: "Subscriptions & Memberships",
        icon: "☁️",
        defaultSpendCategory: "digitalMedia",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "T2125_8810",
          form: "T2125",
          line: "8810",
          name: "Cloud Hosting & Data Storage",
        },
      },
      {
        id: "subscriptions:gaming",
        label: "Gaming (PlayStation, Xbox, Steam)",
        parentId: "subscriptions",
        parentLabel: "Subscriptions & Memberships",
        icon: "🎮",
        defaultSpendCategory: "digitalMedia",
        defaultPaymentRail: "card",
      },
      {
        id: "subscriptions:news_media",
        label: "News & Publications",
        parentId: "subscriptions",
        parentLabel: "Subscriptions & Memberships",
        icon: "📰",
        defaultSpendCategory: "digitalMedia",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_31390",
          form: "T1 General",
          line: "31390",
          name: "Digital News Subscription Tax Credit (QC/CRA Approved)",
        },
      },
      {
        id: "subscriptions:gym_fitness",
        label: "Gym & Fitness Memberships",
        parentId: "subscriptions",
        parentLabel: "Subscriptions & Memberships",
        icon: "🏋️",
        defaultSpendCategory: "memberships",
        defaultPaymentRail: "card",
      },
      {
        id: "subscriptions:clubs_memberships",
        label: "Clubs & Memberships (Costco, CAA, Social)",
        parentId: "subscriptions",
        parentLabel: "Subscriptions & Memberships",
        icon: "🎟️",
        defaultSpendCategory: "memberships",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "government",
    label: "Government & Taxes",
    icon: "🏛️",
    subcategories: [
      {
        id: "government:income_tax",
        label: "Income Tax (CRA Installments)",
        parentId: "government",
        parentLabel: "Government & Taxes",
        icon: "🍁",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale:
          "CRA does not accept direct credit card payments without third-party surcharges (e.g. PaySimply 2.5%). Triangle Bill Pay earns 1% CT Money.",
        intermediaryTarget: "triangle-bill-pay",
      },
      {
        id: "government:property_tax",
        label: "Property Tax (Municipal)",
        parentId: "government",
        parentLabel: "Government & Taxes",
        icon: "🏛️",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Direct municipal property tax. Best paid via Triangle Bill Pay (1% CT Money with 0% fee).",
        intermediaryTarget: "triangle-bill-pay",
      },
      {
        id: "government:licence_registration",
        label: "Licence & Vehicle Registration",
        parentId: "government",
        parentLabel: "Government & Taxes",
        icon: "🪪",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
      },
      {
        id: "government:fees",
        label: "Government Fees & Fines",
        parentId: "government",
        parentLabel: "Government & Taxes",
        icon: "⚖️",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "health",
    label: "Health & Wellness",
    icon: "🏥",
    subcategories: [
      {
        id: "health:medical",
        label: "Medical & Physician Care",
        parentId: "health",
        parentLabel: "Health & Wellness",
        icon: "🩺",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_33099",
          form: "T1 General",
          line: "33099",
          name: "Medical Expense Tax Credit (METC)",
        },
      },
      {
        id: "health:dental",
        label: "Dental Care",
        parentId: "health",
        parentLabel: "Health & Wellness",
        icon: "🦷",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_33099",
          form: "T1 General",
          line: "33099",
          name: "Dental Services (Eligible Medical Expense)",
        },
      },
      {
        id: "health:pharmacy",
        label: "Pharmacy & Prescriptions",
        parentId: "health",
        parentLabel: "Health & Wellness",
        icon: "💊",
        defaultSpendCategory: "drugStore",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_33099",
          form: "T1 General",
          line: "33099",
          name: "Prescription Medications (METC)",
        },
      },
      {
        id: "health:therapy",
        label: "Therapy & Mental Health (Physio, RMT, Psych)",
        parentId: "health",
        parentLabel: "Health & Wellness",
        icon: "🧠",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_33099",
          form: "T1 General",
          line: "33099",
          name: "Registered Therapy / Practitioner (METC)",
        },
      },
      {
        id: "health:fitness",
        label: "Rehabilitative / Medical Fitness",
        parentId: "health",
        parentLabel: "Health & Wellness",
        icon: "🧘",
        defaultSpendCategory: "memberships",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "education",
    label: "Education & Professional",
    icon: "🎓",
    subcategories: [
      {
        id: "education:tuition",
        label: "Tuition (University / College)",
        parentId: "education",
        parentLabel: "Education & Professional",
        icon: "🎓",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale:
          "Canadian colleges and universities do not take credit cards directly without 2%+ surcharges. Triangle Bill Pay earns 1% CT Money.",
        intermediaryTarget: "triangle-bill-pay",
        craTaxSchedule: {
          lineKey: "PERSONAL_32300",
          form: "Schedule 11 / T2202",
          line: "32300",
          name: "Tuition, Education, and Textbook Amounts",
        },
      },
      {
        id: "education:courses",
        label: "Courses & Continuing Education",
        parentId: "education",
        parentLabel: "Education & Professional",
        icon: "📚",
        defaultSpendCategory: "digitalMedia",
        defaultPaymentRail: "card",
      },
      {
        id: "education:certifications",
        label: "Certifications & Exam Fees",
        parentId: "education",
        parentLabel: "Education & Professional",
        icon: "📜",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_32300_EXAMS",
          form: "Schedule 11",
          line: "32300",
          name: "Occupational Examination Fees (Eligible Tuition Credit)",
        },
      },
      {
        id: "education:professional_dues",
        label: "Professional & Union Dues",
        parentId: "education",
        parentLabel: "Education & Professional",
        icon: "👔",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_21200",
          form: "T1 General",
          line: "21200",
          name: "Annual Professional or Union Dues (100% Tax Deductible)",
        },
      },
    ],
  },
  {
    id: "financial",
    label: "Financial Services",
    icon: "🏦",
    subcategories: [
      {
        id: "financial:bank_fees",
        label: "Bank Account Fees",
        parentId: "financial",
        parentLabel: "Financial Services",
        icon: "🏦",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Monthly bank plan fees are automatically deducted from the bank account itself.",
      },
      {
        id: "financial:account_fees",
        label: "Account & Service Fees",
        parentId: "financial",
        parentLabel: "Financial Services",
        icon: "📋",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Financial account maintenance fees clear directly via account balance debit.",
      },
      {
        id: "financial:investment_advisory",
        label: "Investment & Advisory Fees",
        parentId: "financial",
        parentLabel: "Financial Services",
        icon: "📊",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Management and advisory fees are billed against investment portfolios.",
        craTaxSchedule: {
          lineKey: "PERSONAL_22100",
          form: "T1 General",
          line: "22100",
          name: "Carrying Charges & Investment Management Fees",
        },
      },
    ],
  },
  {
    id: "family",
    label: "Family & Personal",
    icon: "👨‍👩‍👧",
    subcategories: [
      {
        id: "family:childcare",
        label: "Childcare & Daycare",
        parentId: "family",
        parentLabel: "Family & Personal",
        icon: "👶",
        defaultSpendCategory: "memberships",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_21400",
          form: "Form T778",
          line: "21400",
          name: "Child Care Expenses Deduction (Up to $8k/child)",
        },
      },
      {
        id: "family:family_support",
        label: "Family Support & Alimony",
        parentId: "family",
        parentLabel: "Family & Personal",
        icon: "🤝",
        defaultPaymentRail: "pad",
        isCardExcluded: true,
        exclusionRationale: "Court-ordered and agreement support payments clear via direct banking transfer.",
        craTaxSchedule: {
          lineKey: "PERSONAL_22000",
          form: "T1 General",
          line: "22000",
          name: "Support Payments Made (Deductible Spousal Support)",
        },
      },
      {
        id: "family:personal_services",
        label: "Personal & Home Services",
        parentId: "family",
        parentLabel: "Family & Personal",
        icon: "🧹",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
      },
    ],
  },
  {
    id: "donations",
    label: "Donations & Charity",
    icon: "❤️",
    subcategories: [
      {
        id: "donations:recurring",
        label: "Recurring Charitable Donations",
        parentId: "donations",
        parentLabel: "Donations & Charity",
        icon: "❤️",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_34900",
          form: "T1 General",
          line: "34900",
          name: "Charitable Donations (15%-33% Federal + Provincial Tax Credit)",
        },
      },
      {
        id: "donations:one_time",
        label: "One-Time Donations",
        parentId: "donations",
        parentLabel: "Donations & Charity",
        icon: "🎁",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "card",
        craTaxSchedule: {
          lineKey: "PERSONAL_34900",
          form: "T1 General",
          line: "34900",
          name: "Charitable Donations Tax Credit",
        },
      },
    ],
  },
  {
    id: "other",
    label: "Other",
    icon: "📦",
    subcategories: [
      {
        id: "other:uncategorized",
        label: "Uncategorized / Other Household Expense",
        parentId: "other",
        parentLabel: "Other",
        icon: "📦",
        defaultSpendCategory: "recurring",
        defaultPaymentRail: "unknown",
      },
    ],
  },
];

// Flat map of all subcategories by ID
export const BILL_SUBCATEGORY_MAP: ReadonlyMap<string, BillSubcategoryDef> = new Map(
  BILL_PARENT_CATEGORIES.flatMap((p) => p.subcategories.map((sub) => [sub.id, sub] as const)),
);

// Map of parent categories by ID
export const BILL_PARENT_CATEGORY_MAP: ReadonlyMap<string, BillParentCategoryDef> = new Map(
  BILL_PARENT_CATEGORIES.map((p) => [p.id, p] as const),
);

/**
 * Legacy category mappings from pre-expansion vocabulary.
 * Ensures that existing bills stored with legacy tokens (e.g. "housing", "utilities", "subscriptions")
 * resolve cleanly without data migrations.
 */
export const LEGACY_BILL_CATEGORY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  housing: "housing",
  rent: "housing:rent",
  mortgage: "housing:mortgage",
  condo: "housing:condo_fees",
  utilities: "utilities",
  hydro: "utilities:electricity_hydro",
  water: "utilities:water_sewer",
  gas: "utilities:natural_gas",
  telecom: "utilities:mobile_phone",
  subscriptions: "subscriptions",
  streaming: "subscriptions:streaming",
  gym: "subscriptions:gym_fitness",
  saas: "subscriptions:software_saas",
  transport: "transportation:transit",
  transportation: "transportation",
  transit: "transportation:transit",
  debt: "debt",
  loan: "debt:personal_loan",
  insurance: "insurance",
  property_tax: "housing:property_tax",
  tuition: "education:tuition",
  government: "government",
  taxes: "government:income_tax",
  health: "health",
  education: "education",
  financial: "financial",
  family: "family",
  donations: "donations",
  charity: "donations:recurring",
  other: "other:uncategorized",
  uncategorized: "other:uncategorized",
});

/**
 * Resolves any category token (canonical, parent, subcategory, or legacy alias)
 * to its metadata and resolved taxonomy definition.
 */
export function resolveBillTaxonomy(rawCategory?: string | null): {
  id: string;
  parentId: string;
  parentLabel: string;
  label: string;
  icon: string;
  formattedLabel: string;
  defaultSpendCategory: string | null;
  defaultPaymentRail: "card" | "pad" | "card_via_third_party" | "unknown";
  isCardExcluded: boolean;
  exclusionRationale?: string;
  intermediaryTarget?: string;
} {
  const fallback = {
    id: "other:uncategorized",
    parentId: "other",
    parentLabel: "Other",
    label: "Other Household Expense",
    icon: "📦",
    formattedLabel: "Other · Other Household Expense",
    defaultSpendCategory: "recurring",
    defaultPaymentRail: "unknown" as const,
    isCardExcluded: false,
  };

  if (!rawCategory) return fallback;
  const trimmed = rawCategory.trim();
  const lowered = trimmed.toLowerCase();

  // 1. Exact subcategory match
  const directSub = BILL_SUBCATEGORY_MAP.get(trimmed) || BILL_SUBCATEGORY_MAP.get(lowered);
  if (directSub) {
    return {
      id: directSub.id,
      parentId: directSub.parentId,
      parentLabel: directSub.parentLabel,
      label: directSub.label,
      icon: directSub.icon,
      formattedLabel: `${directSub.parentLabel} · ${directSub.label}`,
      defaultSpendCategory: directSub.defaultSpendCategory ?? null,
      defaultPaymentRail: directSub.defaultPaymentRail ?? "unknown",
      isCardExcluded: Boolean(directSub.isCardExcluded),
      exclusionRationale: directSub.exclusionRationale,
      intermediaryTarget: directSub.intermediaryTarget,
    };
  }

  // 2. Exact parent category match (e.g. "housing", "utilities")
  const directParent = BILL_PARENT_CATEGORY_MAP.get(trimmed) || BILL_PARENT_CATEGORY_MAP.get(lowered);
  if (directParent) {
    // Parent level defaults based on parent semantics
    const isExcluded = ["housing", "debt", "financial", "government"].includes(directParent.id);
    let spendCat: string | null = "recurring";
    if (directParent.id === "utilities") spendCat = "householdUtilities";
    else if (directParent.id === "transportation") spendCat = "transit";
    else if (directParent.id === "subscriptions") spendCat = "digitalMedia";
    else if (isExcluded) spendCat = null;

    return {
      id: directParent.id,
      parentId: directParent.id,
      parentLabel: directParent.label,
      label: directParent.label,
      icon: directParent.icon,
      formattedLabel: directParent.label,
      defaultSpendCategory: spendCat,
      defaultPaymentRail: isExcluded ? "pad" : "card",
      isCardExcluded: isExcluded,
      exclusionRationale: isExcluded
        ? `${directParent.label} payments typically face non-chargeable or high third-party surcharge economics.`
        : undefined,
    };
  }

  // 3. Check legacy aliases
  const aliasedId = LEGACY_BILL_CATEGORY_ALIASES[lowered];
  if (aliasedId) {
    return resolveBillTaxonomy(aliasedId);
  }

  // 4. Return unmapped custom fallback
  const label = trimmed.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
  return {
    id: trimmed,
    parentId: "other",
    parentLabel: "Other",
    label: capitalized,
    icon: "🏷️",
    formattedLabel: capitalized,
    defaultSpendCategory: "recurring",
    defaultPaymentRail: "unknown",
    isCardExcluded: false,
  };
}

/**
 * Returns human-friendly presentation info for a bill category badge or header.
 */
export function formatBillCategoryLabel(category?: string | null): string {
  const resolved = resolveBillTaxonomy(category);
  return `${resolved.icon} ${resolved.formattedLabel}`;
}

/**
 * Returns all valid bill category IDs (both parent and subcategory IDs) for Zod schemas and validation.
 */
export function getAllValidBillCategoryIds(): string[] {
  const subIds = BILL_PARENT_CATEGORIES.flatMap((p) => p.subcategories.map((sub) => sub.id));
  const parentIds = BILL_PARENT_CATEGORIES.map((p) => p.id);
  const legacyIds = Object.keys(LEGACY_BILL_CATEGORY_ALIASES);
  return [...new Set([...subIds, ...parentIds, ...legacyIds])];
}
