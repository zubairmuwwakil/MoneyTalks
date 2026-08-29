/**
 * CRA (Canada Revenue Agency) Tax Line Taxonomy & Form Specifications
 *
 * Defines the standard forms and lines used for Canadian business expenses (T2125),
 * employment remote work expenses (T777), and common personal deductions/credits (T1).
 */

export type CraFormType = "T2125" | "T777" | "PERSONAL_T1";

export interface CraTaxLineDef {
  form: CraFormType;
  line: string;
  name: string;
  categoryName: string;
  defaultBusinessPct: number;
  statutoryLimitPct?: number; // e.g. 50% for meals and entertainment
  description: string;
  craCitation: string;
  eligiblePersonas: Array<"SELF_EMPLOYED" | "EMPLOYEE" | "ALL">;
}

export const CRA_TAX_LINES: Record<string, CraTaxLineDef> = {
  // --- Form T2125: Statement of Business or Professional Activities ---
  T2125_8810: {
    form: "T2125",
    line: "8810",
    name: "Office & Software Subscriptions",
    categoryName: "Software & Office",
    defaultBusinessPct: 100,
    description: "SaaS subscriptions, cloud hosting, AI tools, developer software, and office supplies.",
    craCitation: "CRA Form T2125 Line 8810 (Office expenses) & Line 8871 (Management and administration fees)",
    eligiblePersonas: ["SELF_EMPLOYED"],
  },
  T2125_9281: {
    form: "T2125",
    line: "9281",
    name: "Telephone & Utilities",
    categoryName: "Telecom & Utilities",
    defaultBusinessPct: 50,
    description: "Cell phone plan, high-speed internet, and utilities used for business operations.",
    craCitation: "CRA Form T2125 Line 9281 (Telephone and utilities) & Line 9945 (Business-use-of-home expenses)",
    eligiblePersonas: ["SELF_EMPLOYED"],
  },
  T2125_8521: {
    form: "T2125",
    line: "8521",
    name: "Advertising & Marketing",
    categoryName: "Advertising",
    defaultBusinessPct: 100,
    description: "Google/Meta ads, website hosting, domain renewals, newsletters, and marketing materials.",
    craCitation: "CRA Form T2125 Line 8521 (Advertising)",
    eligiblePersonas: ["SELF_EMPLOYED"],
  },
  T2125_8523: {
    form: "T2125",
    line: "8523",
    name: "Meals & Entertainment (50% rule)",
    categoryName: "Meals & Entertainment",
    defaultBusinessPct: 50,
    statutoryLimitPct: 50, // CRA Income Tax Act statutory 50% cap
    description: "Business meals and client hospitality. Strictly subject to CRA 50% deduction limit.",
    craCitation: "CRA Form T2125 Line 8523 & Income Tax Act subsection 67.1(1)",
    eligiblePersonas: ["SELF_EMPLOYED"],
  },
  T2125_8860: {
    form: "T2125",
    line: "8860",
    name: "Professional & Legal Fees",
    categoryName: "Professional Services",
    defaultBusinessPct: 100,
    description: "Accounting, bookkeeping, legal counsel, and business licensing.",
    craCitation: "CRA Form T2125 Line 8860 (Professional fees)",
    eligiblePersonas: ["SELF_EMPLOYED"],
  },
  T2125_9200: {
    form: "T2125",
    line: "9200",
    name: "Business Travel & Lodging",
    categoryName: "Travel",
    defaultBusinessPct: 100,
    description: "Flights, trains, hotels, and business rideshare (Uber/Lyft) to conferences or client sites.",
    craCitation: "CRA Form T2125 Line 9200 (Travel expenses)",
    eligiblePersonas: ["SELF_EMPLOYED"],
  },
  T2125_9270: {
    form: "T2125",
    line: "9270",
    name: "Other Business Expenses / Supplies",
    categoryName: "Supplies",
    defaultBusinessPct: 100,
    description: "Hardware accessories, cables, shipping, and miscellaneous operating expenses.",
    craCitation: "CRA Form T2125 Line 9270 (Other expenses)",
    eligiblePersonas: ["SELF_EMPLOYED"],
  },

  // --- Form T777: Statement of Employment Expenses (Remote Employees) ---
  T777_HOME_UTILITIES: {
    form: "T777",
    line: "T777-Utilities",
    name: "Home Office Utilities (Remote Employee)",
    categoryName: "Home Office",
    defaultBusinessPct: 15, // Suggested default workspace square footage ratio
    description: "Electricity, heating, water, and home internet access fees. Requires signed employer Form T2200.",
    craCitation: "CRA Form T777 / T777S (Employment-use-of-home expenses)",
    eligiblePersonas: ["EMPLOYEE"],
  },
  T777_STATIONERY: {
    form: "T777",
    line: "T777-Supplies",
    name: "Employment Supplies & Stationery",
    categoryName: "Office Supplies",
    defaultBusinessPct: 100,
    description: "Consumable office supplies (paper, pens, toner) consumed directly in employment.",
    craCitation: "CRA Form T777 Line (Office supplies)",
    eligiblePersonas: ["EMPLOYEE"],
  },

  // --- Personal T1 Deductions & Non-Refundable Credits ---
  PERSONAL_33099: {
    form: "PERSONAL_T1",
    line: "33099",
    name: "Eligible Medical Expenses",
    categoryName: "Medical & Health",
    defaultBusinessPct: 100,
    description: "Prescription medications, dental treatments, vision/glasses, physiotherapy, registered therapy.",
    craCitation: "CRA Income Tax Return Line 33099 (Medical expenses for self, spouse or common-law partner)",
    eligiblePersonas: ["ALL"],
  },
  PERSONAL_34900: {
    form: "PERSONAL_T1",
    line: "34900",
    name: "Charitable Donations",
    categoryName: "Donations",
    defaultBusinessPct: 100,
    description: "Official donations to CRA-registered Canadian charities.",
    craCitation: "CRA Income Tax Return Line 34900 (Donations and gifts)",
    eligiblePersonas: ["ALL"],
  },
  PERSONAL_21200: {
    form: "PERSONAL_T1",
    line: "21200",
    name: "Annual Professional or Union Dues",
    categoryName: "Dues & Licensing",
    defaultBusinessPct: 100,
    description: "Statutory membership dues required to maintain professional status (CPA, P.Eng, Law Society, etc.).",
    craCitation: "CRA Income Tax Return Line 21200 (Annual union, professional, or like dues)",
    eligiblePersonas: ["ALL"],
  },
  PERSONAL_21900: {
    form: "PERSONAL_T1",
    line: "21900",
    name: "Eligible Moving Expenses",
    categoryName: "Moving",
    defaultBusinessPct: 100,
    description: "Moving costs when relocating at least 40 km closer to a new job or post-secondary school.",
    craCitation: "CRA Form T1-M / Line 21900 (Moving expenses)",
    eligiblePersonas: ["ALL"],
  },
};
