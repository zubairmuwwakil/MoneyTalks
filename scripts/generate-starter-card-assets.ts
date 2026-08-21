import fs from "fs";
import path from "path";
import { cardCatalogue } from "../src/lib/contracts/cardCatalogue";

const outputDir = path.join(process.cwd(), "public", "cards");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

interface CardStyle {
  bgStart: string;
  bgEnd: string;
  textColor: string;
  subtextColor: string;
  accent: string;
  badgeBg: string;
  isLight?: boolean;
  extraSvg?: string;
}

const STYLES: Record<string, CardStyle> = {
  "amex-platinum": {
    bgStart: "#f1f5f9",
    bgEnd: "#cbd5e1",
    textColor: "#0f172a",
    subtextColor: "#475569",
    accent: "#64748b",
    badgeBg: "#0f172a",
    isLight: true,
    extraSvg: `
      <rect x="20" y="20" width="360" height="212" rx="14" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.6"/>
      <circle cx="200" cy="126" r="45" fill="none" stroke="#64748b" stroke-width="1" opacity="0.3"/>
    `,
  },
  "amex-cobalt": {
    bgStart: "#003087",
    bgEnd: "#00122e",
    textColor: "#ffffff",
    subtextColor: "#93c5fd",
    accent: "#38bdf8",
    badgeBg: "#1e3a8a",
    extraSvg: `
      <path d="M 0 180 Q 200 60 400 120" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.3"/>
      <path d="M 0 220 Q 250 100 400 160" fill="none" stroke="#60a5fa" stroke-width="1.5" opacity="0.2"/>
    `,
  },
  "amex-bonvoy": {
    bgStart: "#3b0713",
    bgEnd: "#1a0408",
    textColor: "#fef2f2",
    subtextColor: "#fca5a5",
    accent: "#f59e0b",
    badgeBg: "#7f1d1d",
    extraSvg: `
      <circle cx="340" cy="60" r="80" fill="#f59e0b" opacity="0.06"/>
    `,
  },
  "amex-simplycash": {
    bgStart: "#0284c7",
    bgEnd: "#082f49",
    textColor: "#ffffff",
    subtextColor: "#bae6fd",
    accent: "#38bdf8",
    badgeBg: "#0369a1",
  },
  "scotia-gold-amex": {
    bgStart: "#b45309",
    bgEnd: "#451a03",
    textColor: "#ffffff",
    subtextColor: "#fef3c7",
    accent: "#fbbf24",
    badgeBg: "#92400e",
    extraSvg: `
      <path d="M 400 0 L 250 252" stroke="#dc2626" stroke-width="8" opacity="0.35"/>
    `,
  },
  "scotia-momentum-vi-plus": {
    bgStart: "#881337",
    bgEnd: "#4c0519",
    textColor: "#ffffff",
    subtextColor: "#fecdd3",
    accent: "#f43f5e",
    badgeBg: "#9f1239",
    extraSvg: `
      <path d="M -20 180 Q 150 50 420 100" fill="none" stroke="#fb7185" stroke-width="3" opacity="0.25"/>
    `,
  },
  "scotia-passport-visa-infinite-plus": {
    bgStart: "#0f172a",
    bgEnd: "#020617",
    textColor: "#ffffff",
    subtextColor: "#94a3b8",
    accent: "#38bdf8",
    badgeBg: "#1e293b",
    extraSvg: `
      <circle cx="330" cy="126" r="70" fill="none" stroke="#38bdf8" stroke-width="1.5" opacity="0.25"/>
      <circle cx="330" cy="126" r="45" fill="none" stroke="#38bdf8" stroke-width="1" opacity="0.2"/>
    `,
  },
  "td-aeroplan-visa-infinite": {
    bgStart: "#00843D",
    bgEnd: "#022c22",
    textColor: "#ffffff",
    subtextColor: "#a7f3d0",
    accent: "#34d399",
    badgeBg: "#065f46",
    extraSvg: `
      <path d="M 300 40 L 370 120 L 300 200 Z" fill="#ffffff" opacity="0.05"/>
      <circle cx="330" cy="80" r="25" fill="#dc2626" opacity="0.2"/>
    `,
  },
  "td-first-class-travel-visa-infinite": {
    bgStart: "#064e3b",
    bgEnd: "#022c22",
    textColor: "#ffffff",
    subtextColor: "#6ee7b7",
    accent: "#a7f3d0",
    badgeBg: "#047857",
  },
  "td-cash-back-visa-infinite": {
    bgStart: "#059669",
    bgEnd: "#064e3b",
    textColor: "#ffffff",
    subtextColor: "#a7f3d0",
    accent: "#6ee7b7",
    badgeBg: "#047857",
  },
  "rbc-avion-visa-infinite": {
    bgStart: "#1d4ed8",
    bgEnd: "#0f172a",
    textColor: "#ffffff",
    subtextColor: "#bfdbfe",
    accent: "#60a5fa",
    badgeBg: "#1e40af",
    extraSvg: `
      <path d="M 0 50 Q 200 180 400 80" fill="none" stroke="#93c5fd" stroke-width="2" opacity="0.3"/>
    `,
  },
  "rbc-ion-plus-visa": {
    bgStart: "#be123c",
    bgEnd: "#4c0519",
    textColor: "#ffffff",
    subtextColor: "#fecdd3",
    accent: "#fb7185",
    badgeBg: "#9f1239",
    extraSvg: `
      <polygon points="320,30 380,100 340,180 280,110" fill="#f43f5e" opacity="0.15"/>
    `,
  },
  "westjet-rbc-world-elite": {
    bgStart: "#0d9488",
    bgEnd: "#134e4a",
    textColor: "#ffffff",
    subtextColor: "#99f6e4",
    accent: "#2dd4bf",
    badgeBg: "#115e59",
    extraSvg: `
      <path d="M 280 40 Q 360 80 400 180" fill="none" stroke="#2dd4bf" stroke-width="3" opacity="0.3"/>
    `,
  },
  "cibc-dividend-visa-infinite": {
    bgStart: "#991b1b",
    bgEnd: "#450a0a",
    textColor: "#ffffff",
    subtextColor: "#fecaca",
    accent: "#f87171",
    badgeBg: "#7f1d1d",
  },
  "cibc-aventura-visa-infinite": {
    bgStart: "#1e293b",
    bgEnd: "#090d16",
    textColor: "#ffffff",
    subtextColor: "#cbd5e1",
    accent: "#ef4444",
    badgeBg: "#334155",
    extraSvg: `
      <circle cx="340" cy="70" r="6" fill="#ef4444"/>
    `,
  },
  "cibc-aventura-visa": {
    bgStart: "#334155",
    bgEnd: "#0f172a",
    textColor: "#ffffff",
    subtextColor: "#94a3b8",
    accent: "#ef4444",
    badgeBg: "#1e293b",
  },
  "bmo-eclipse-visa-infinite": {
    bgStart: "#312e81",
    bgEnd: "#0f172a",
    textColor: "#ffffff",
    subtextColor: "#c7d2fe",
    accent: "#818cf8",
    badgeBg: "#3730a3",
    extraSvg: `
      <circle cx="300" cy="126" r="60" fill="none" stroke="#818cf8" stroke-width="2" opacity="0.3"/>
      <circle cx="315" cy="120" r="50" fill="#0f172a" opacity="0.6"/>
    `,
  },
  "bmo-ascend-world-elite": {
    bgStart: "#0079c1",
    bgEnd: "#0c2340",
    textColor: "#ffffff",
    subtextColor: "#bae6fd",
    accent: "#38bdf8",
    badgeBg: "#0369a1",
  },
  "national-bank-world-elite": {
    bgStart: "#b91c1c",
    bgEnd: "#450a0a",
    textColor: "#ffffff",
    subtextColor: "#fecaca",
    accent: "#fca5a5",
    badgeBg: "#991b1b",
  },
  "tangerine-moneyback-world": {
    bgStart: "#ea580c",
    bgEnd: "#7c2d12",
    textColor: "#ffffff",
    subtextColor: "#ffedd5",
    accent: "#fed7aa",
    badgeBg: "#c2410c",
    extraSvg: `
      <circle cx="350" cy="130" r="90" fill="#ffffff" opacity="0.06"/>
    `,
  },
  "rogers-red-we": {
    bgStart: "#dc2626",
    bgEnd: "#7f1d1d",
    textColor: "#ffffff",
    subtextColor: "#fee2e2",
    accent: "#fca5a5",
    badgeBg: "#b91c1c",
    extraSvg: `
      <path d="M 0 100 Q 200 240 400 160" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.2"/>
    `,
  },
  "mbna-rewards-we": {
    bgStart: "#0369a1",
    bgEnd: "#082f49",
    textColor: "#ffffff",
    subtextColor: "#bae6fd",
    accent: "#38bdf8",
    badgeBg: "#0284c7",
  },
  "triangle-we": {
    bgStart: "#18181b",
    bgEnd: "#09090b",
    textColor: "#ffffff",
    subtextColor: "#a1a1aa",
    accent: "#ef4444",
    badgeBg: "#27272a",
    extraSvg: `
      <polygon points="320,50 360,120 280,120" fill="#dc2626" opacity="0.6"/>
    `,
  },
  "wealthsimple-vip": {
    bgStart: "#18181b",
    bgEnd: "#000000",
    textColor: "#ffffff",
    subtextColor: "#a1a1aa",
    accent: "#d4af37",
    badgeBg: "#27272a",
    extraSvg: `
      <line x1="30" y1="210" x2="370" y2="210" stroke="#d4af37" stroke-width="1" opacity="0.5"/>
    `,
  },
  "pc-insiders-world-elite": {
    bgStart: "#831843",
    bgEnd: "#500724",
    textColor: "#ffffff",
    subtextColor: "#fbcfe8",
    accent: "#f472b6",
    badgeBg: "#9d174d",
  },
  "amazon-ca-rewards-mastercard": {
    bgStart: "#1e293b",
    bgEnd: "#0f172a",
    textColor: "#ffffff",
    subtextColor: "#94a3b8",
    accent: "#f59e0b",
    badgeBg: "#334155",
    extraSvg: `
      <path d="M 280 180 Q 320 200 360 180" fill="none" stroke="#f59e0b" stroke-width="3"/>
    `,
  },
  "cryptocom-royal-indigo": {
    bgStart: "#4338ca",
    bgEnd: "#1e1b4b",
    textColor: "#ffffff",
    subtextColor: "#c7d2fe",
    accent: "#a5b4fc",
    badgeBg: "#3730a3",
    extraSvg: `
      <circle cx="320" cy="120" r="50" fill="none" stroke="#a5b4fc" stroke-width="2" opacity="0.3"/>
    `,
  },
};

function generateCardSvg(cardId: string, officialName: string, issuer: string, network: string): string {
  const style = STYLES[cardId] || {
    bgStart: "#1e293b",
    bgEnd: "#0f172a",
    textColor: "#ffffff",
    subtextColor: "#94a3b8",
    accent: "#38bdf8",
    badgeBg: "#334155",
  };

  const netUpper = network.toUpperCase();

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 252" width="400" height="252">
  <defs>
    <linearGradient id="cardBg-${cardId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${style.bgStart}" />
      <stop offset="100%" stop-color="${style.bgEnd}" />
    </linearGradient>
    <linearGradient id="chipGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fde68a" />
      <stop offset="50%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- Card Body -->
  <rect width="400" height="252" rx="16" fill="url(#cardBg-${cardId})" filter="url(#shadow)"/>
  <rect width="398" height="250" x="1" y="1" rx="15" fill="none" stroke="${style.isLight ? '#cbd5e1' : 'rgba(255,255,255,0.12)'}" stroke-width="1.5"/>

  <!-- Sheen highlights -->
  <circle cx="340" cy="20" r="140" fill="white" opacity="${style.isLight ? '0.25' : '0.04'}"/>
  <circle cx="20" cy="230" r="120" fill="black" opacity="0.15"/>

  ${style.extraSvg || ""}

  <!-- Issuer -->
  <text x="28" y="42" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" letter-spacing="1.2" fill="${style.subtextColor}" text-transform="uppercase">
    ${issuer}
  </text>

  <!-- Card Name -->
  <text x="28" y="66" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="800" letter-spacing="-0.2" fill="${style.textColor}">
    ${officialName.length > 32 ? officialName.slice(0, 30) + '…' : officialName}
  </text>

  <!-- EMV Chip -->
  <g transform="translate(28, 102)">
    <rect width="42" height="32" rx="5" fill="url(#chipGrad)" stroke="#b45309" stroke-width="0.8"/>
    <line x1="14" y1="0" x2="14" y2="32" stroke="#92400e" stroke-width="0.7" opacity="0.7"/>
    <line x1="28" y1="0" x2="28" y2="32" stroke="#92400e" stroke-width="0.7" opacity="0.7"/>
    <line x1="0" y1="16" x2="42" y2="16" stroke="#92400e" stroke-width="0.7" opacity="0.7"/>
  </g>

  <!-- Contactless Waves -->
  <g transform="translate(82, 110)" stroke="${style.subtextColor}" stroke-width="2" fill="none" stroke-linecap="round" opacity="0.7">
    <path d="M 0 16 A 12 12 0 0 1 0 0"/>
    <path d="M 6 20 A 18 18 0 0 1 6 -4"/>
    <path d="M 12 24 A 24 24 0 0 1 12 -8"/>
  </g>

  <!-- Masked Digits -->
  <text x="28" y="196" font-family="'SF Mono', Menlo, Monaco, Consolas, monospace" font-size="13" letter-spacing="3" fill="${style.subtextColor}">
    •••• •••• •••• 8888
  </text>

  <!-- Network Badge -->
  <g transform="translate(310, 192)">
    <rect x="-4" y="-14" width="70" height="24" rx="4" fill="${style.badgeBg}" stroke="${style.accent}" stroke-width="1" opacity="0.85"/>
    <text x="31" y="2" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="900" letter-spacing="1.5" fill="${style.textColor}" text-anchor="middle">
      ${netUpper}
    </text>
  </g>
</svg>`;
}

console.log("Generating starter card assets for", cardCatalogue.cards.length, "cards...");

for (const card of cardCatalogue.cards) {
  const svg = generateCardSvg(card.cardId, card.officialName, card.issuer, card.network);
  const svgPath = path.join(outputDir, `${card.cardId}.svg`);
  const webpPath = path.join(outputDir, `${card.cardId}.webp`);
  fs.writeFileSync(svgPath, svg, "utf-8");
  // Also write as webp / svg alias so next/image can load either seamlessly
  fs.writeFileSync(webpPath, svg, "utf-8");
}

console.log("Done! Assets written to", outputDir);
