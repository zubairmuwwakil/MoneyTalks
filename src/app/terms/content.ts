// The published Terms of Service, as structured content.
//
// Like `src/app/privacy/content.ts`, this text is the legally operative artifact
// and is tested by `terms-page.test.ts` to ensure consistent legal disclosures,
// disclaimers, and contact details without template placeholders.

export const EFFECTIVE_DATE = "19 August 2026";
export const CONTACT_EMAIL = "zmuwwakil1@gmail.com";
export const PUBLISHER = "Zubair Muwwakil";
export const TERMS_URL = "https://moneytalks.zubairmuwwakil.com/terms";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "sub"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export type Section = {
  id: string;
  title: string;
  blocks: Block[];
};

export const SECTIONS: Section[] = [
  {
    id: "acceptance-of-terms",
    title: "Acceptance of Terms",
    blocks: [
      {
        kind: "p",
        text: `These Terms of Service ("Terms") constitute a legally binding agreement between you and ${PUBLISHER} ("Publisher", "we", "us", or "our") governing your access to and use of the Inunity web application, the PickMe iOS application, and any associated shortcuts, tools, and services (collectively, the "Service").`,
      },
      {
        kind: "p",
        text: "By downloading the app, accessing our website, creating an account, or otherwise using any part of the Service, you acknowledge that you have read, understood, and agree to be bound by these Terms and our [Privacy Policy](/privacy).",
      },
      {
        kind: "note",
        text: "If you do not agree to these Terms or our Privacy Policy, you must not access or use the Service, and you should uninstall the application from your devices.",
      },
    ],
  },
  {
    id: "who-is-responsible",
    title: "Who is Responsible",
    blocks: [
      {
        kind: "p",
        text: `The Service is built, operated, and maintained by ${PUBLISHER}, an individual independent developer based in Canada, rather than an incorporated corporation.`,
      },
      {
        kind: "p",
        text: `All legal notices, questions, inquiries, and dispute notices regarding these Terms or the Service should be directed to ${CONTACT_EMAIL}.`,
      },
    ],
  },
  {
    id: "description-of-service",
    title: "Description of the Service",
    blocks: [
      {
        kind: "p",
        text: "Inunity and PickMe provide personal finance tooling designed to help individuals organize financial records, optimize payment methods, track multi-currency assets, forecast upcoming bills, and monitor merchant return windows.",
      },
      {
        kind: "bullets",
        items: [
          "**PickMe (iOS Application):** An on-device payment copilot that evaluates card reward multipliers, bonus spend caps, and merchant categories to suggest optimal cards for checkout.",
          "**Inunity Command Center (Web Application):** A financial dashboard for managing recurring bills, multi-currency holdings valuation, statement reconciliation, and regulatory planning checklists (such as CRA and IRS filing schedules).",
          "**Apple Wallet Integration:** An optional client-side iOS Shortcut mechanism to capture transaction metadata without connecting to third-party financial aggregators.",
        ],
      },
      {
        kind: "p",
        text: "Neither the iOS app nor the web application connects to your financial institutions, and neither requests or stores banking credentials, full card numbers, CVVs, or PINs.",
      },
    ],
  },
  {
    id: "financial-and-tax-disclaimer",
    title: "No Financial, Tax, or Legal Advice",
    blocks: [
      {
        kind: "note",
        text: "**CRITICAL DISCLAIMER:** Inunity and PickMe are educational, organizational, and informational tools. The Service does NOT provide personalized financial, investment, accounting, tax, or legal advice.",
      },
      {
        kind: "p",
        text: `${PUBLISHER} is not a registered investment adviser, certified financial planner, chartered professional accountant (CPA), tax preparer, broker-dealer, or legal professional. Nothing contained in the Service should be construed as a financial plan, tax opinion, or recommendation to purchase or sell any security or financial product.`,
      },
      {
        kind: "p",
        text: "All calculations, currency conversions, cashflow projections, estimated tax deadlines, return policy tracking, and reward valuations are automated estimations based on user-provided parameters, publicly available schedules, and third-party data feeds. They may contain inaccuracies or become outdated.",
      },
      {
        kind: "bullets",
        items: [
          "You are solely responsible for verifying your financial decisions, official tax filings (including CRA, IRS, and state/provincial obligations), and bill payment timeliness with qualified professionals.",
          "We assume no liability for missed payment deadlines, penalties, fees, interest accruals, overdrafts, or adverse tax consequences resulting from reliance on the Service.",
        ],
      },
    ],
  },
  {
    id: "card-rules-and-rewards",
    title: "Card Rules, Multipliers, and Issuer Terms",
    blocks: [
      {
        kind: "p",
        text: "Card recommendations are calculated using our catalogue of published credit card terms, reward point valuations, merchant category codes (MCCs), and your personal card selections.",
      },
      {
        kind: "bullets",
        items: [
          "**Issuer Supremacy:** Card issuers (such as American Express, Visa, Mastercard, Chase, Scotiabank, RBC, etc.) change reward terms, fee schedules, point values, bonus spend caps, and eligibility conditions at any time without notice. Your card contract with your issuing bank always supersedes any calculation displayed in the Service.",
          "**Merchant Categorization:** Merchant Category Codes are assigned by payment networks and merchant acquirers. A merchant may categorize transactions differently than expected. We cannot guarantee that a purchase will trigger a specific reward multiplier.",
          "**Point Valuations:** Reward point valuations (e.g., cents per point) are subjective estimates and market averages that fluctuate over time.",
        ],
      },
    ],
  },
  {
    id: "accounts-and-security",
    title: "Accounts, Authentication, and Security",
    blocks: [
      {
        kind: "p",
        text: "You may use the PickMe iOS app locally on your device without registering an account. If you choose to use the Inunity web command center or sync data via server APIs, you must create an account.",
      },
      {
        kind: "bullets",
        items: [
          "**Account Security:** You are responsible for safeguarding your login credentials (managed via Clerk authentication) and any installation tokens generated for iOS Shortcuts.",
          "**Account Responsibility:** You are solely responsible for all activities and data transmissions that occur under your account.",
          "**Accurate Information:** You agree to provide accurate information when registering and to notify us immediately if you suspect unauthorized access to your account.",
        ],
      },
    ],
  },
  {
    id: "user-data-ownership",
    title: "User Data Ownership & Privacy",
    blocks: [
      {
        kind: "p",
        text: "You retain full ownership of all data, transactions, holdings, and profile information you input into the Service. We do not sell your personal data or transaction history to data brokers or advertising networks.",
      },
      {
        kind: "p",
        text: "By inputting data into the Service, you grant us a limited, non-exclusive license to process, store, and display that data solely for the purpose of operating and providing the Service to you.",
      },
      {
        kind: "p",
        text: "For full details regarding how data is stored, isolated, exported, and permanently deleted, please consult our [Privacy Policy](/privacy).",
      },
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use & Restrictions",
    blocks: [
      {
        kind: "p",
        text: "You agree to use the Service only for lawful personal finance management in compliance with all applicable local, provincial, state, national, and international laws.",
      },
      {
        kind: "p",
        text: "You agree not to:",
      },
      {
        kind: "bullets",
        items: [
          "Reverse engineer, decompile, disassemble, or attempt to derive the source code of the Service (except where such restriction is prohibited by law).",
          "Attempt to bypass, compromise, or circumvent authentication controls, rate limits, or security mechanisms.",
          "Scrape, harvest, or systematically extract data from our web applications or APIs using automated scripts or bots without prior authorization.",
          "Use the Service to transmit malware, spam, or abusive network requests.",
          "Interfere with or disrupt the integrity or performance of the servers and infrastructure supporting the Service.",
        ],
      },
    ],
  },
  {
    id: "disclaimer-of-warranties",
    title: "Disclaimer of Warranties",
    blocks: [
      {
        kind: "note",
        text: 'THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, OR UNINTERRUPTED ACCURACY.',
      },
      {
        kind: "p",
        text: "We do not warrant that:",
      },
      {
        kind: "bullets",
        items: [
          "The Service will meet your specific financial requirements or achieve any specific economic outcome or reward earnings.",
          "The Service will be uninterrupted, timely, secure, error-free, or free of software defects.",
          "The results, calculations, reward estimates, or exchange rates generated by the Service will be accurate, reliable, or complete at all times.",
        ],
      },
    ],
  },
  {
    id: "limitation-of-liability",
    title: "Limitation of Liability",
    blocks: [
      {
        kind: "p",
        text: "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE PUBLISHER, DEVELOPERS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION:",
      },
      {
        kind: "bullets",
        items: [
          "Loss of profits, revenue, anticipated savings, reward points, or cashback earnings;",
          "Financial losses, banking fees, overdraft penalties, late payment charges, or interest costs;",
          "Tax assessments, audit penalties, or compliance liabilities with tax authorities (including the CRA or IRS);",
          "Loss of data, business interruption, computer failure, or mobile device malfunction.",
        ],
      },
      {
        kind: "p",
        text: "IN ALL CASES, THE TOTAL AGGREGATE LIABILITY OF THE PUBLISHER UNDER THESE TERMS OR ARISING OUT OF YOUR USE OF THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT PAID BY YOU TO US FOR THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (B) FIFTY CANADIAN DOLLARS (CAD $50.00).",
      },
    ],
  },
  {
    id: "governing-law",
    title: "Governing Law & Jurisdiction",
    blocks: [
      {
        kind: "p",
        text: "These Terms and any disputes arising out of or related to your use of the Service shall be governed by and construed in accordance with the laws of the Province of Ontario and the federal laws of Canada applicable therein, without giving effect to any conflict of law principles.",
      },
      {
        kind: "p",
        text: "Any legal proceeding or claim arising out of or related to the Service must be instituted exclusively in the provincial or federal courts located in Ontario, Canada, and you irrevocably consent to the personal jurisdiction of such courts.",
      },
    ],
  },
  {
    id: "modifications-and-termination",
    title: "Modifications and Termination",
    blocks: [
      {
        kind: "p",
        text: "We reserve the right to modify, amend, or replace these Terms at any time. When modifications are made, we will update the \"Effective Date\" at the top of this page. Your continued use of the Service after the effective date of revised Terms constitutes your acceptance of the changes.",
      },
      {
        kind: "p",
        text: "You may terminate your agreement with these Terms at any time by deleting your account and removing the application from your devices. We reserve the right to suspend or terminate your access to the Service at our discretion if you violate these Terms.",
      },
    ],
  },
  {
    id: "contact",
    title: "Contact Information",
    blocks: [
      {
        kind: "p",
        text: `If you have any questions, concerns, or legal notices regarding these Terms of Service, please reach out to ${PUBLISHER} at:`,
      },
      {
        kind: "bullets",
        items: [
          `Email: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`,
          `Publisher: ${PUBLISHER}`,
          "Website: [inunity.ca](https://inunity.ca)",
        ],
      },
    ],
  },
];
