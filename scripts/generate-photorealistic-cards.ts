import fs from "fs";
import path from "path";
import { cardCatalogue } from "../src/lib/contracts/cardCatalogue";

const outputDir = path.join(process.cwd(), "public", "cards");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

interface RealCardDesign {
  bgSvg: string;
  chip: { x: number; y: number; type: "gold" | "silver" };
  issuerLogoSvg: string;
  cardNameSvg: string;
  networkLogoSvg: string;
  overlaySvg?: string;
}

const DESIGNS: Record<string, RealCardDesign> = {
  "cryptocom-royal-indigo": {
    bgSvg: `
      <defs>
        <linearGradient id="indigoMetal" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#3730a3" />
          <stop offset="25%" stop-color="#4338ca" />
          <stop offset="50%" stop-color="#312e81" />
          <stop offset="75%" stop-color="#4f46e5" />
          <stop offset="100%" stop-color="#1e1b4b" />
        </linearGradient>
        <linearGradient id="silverSheen" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
          <stop offset="50%" stop-color="#ffffff" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="400" height="252" rx="16" fill="url(#indigoMetal)"/>
      <rect width="400" height="252" rx="16" fill="url(#silverSheen)"/>
      
      <!-- Crypto.com Lion Crest Centerpiece -->
      <g transform="translate(160, 76)" opacity="0.35">
        <circle cx="40" cy="45" r="42" fill="none" stroke="#e0e7ff" stroke-width="2.5"/>
        <path d="M 40 18 L 52 35 L 68 35 L 56 48 L 62 65 L 40 52 L 18 65 L 24 48 L 12 35 L 28 35 Z" fill="#e0e7ff" opacity="0.8"/>
      </g>
    `,
    chip: { x: 34, y: 95, type: "silver" },
    issuerLogoSvg: `
      <text x="34" y="44" font-family="-apple-system, sans-serif" font-size="14" font-weight="700" fill="#e0e7ff" letter-spacing="1">crypto.com</text>
    `,
    cardNameSvg: `
      <text x="34" y="218" font-family="-apple-system, sans-serif" font-size="12" font-weight="600" fill="#c7d2fe" letter-spacing="1.5">ROYAL INDIGO</text>
    `,
    networkLogoSvg: `
      <g transform="translate(320, 202)">
        <text x="32" y="14" font-family="-apple-system, sans-serif" font-size="18" font-style="italic" font-weight="900" fill="#ffffff" text-anchor="middle">VISA</text>
      </g>
    `,
  },

  "amex-cobalt": {
    bgSvg: `
      <defs>
        <linearGradient id="cobaltBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#002b66" />
          <stop offset="40%" stop-color="#0047ab" />
          <stop offset="70%" stop-color="#001f4d" />
          <stop offset="100%" stop-color="#000d26" />
        </linearGradient>
        <pattern id="cobaltGrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 0 10 L 20 10 M 10 0 L 10 20" stroke="#38bdf8" stroke-width="0.5" opacity="0.15"/>
          <circle cx="10" cy="10" r="1.5" fill="#38bdf8" opacity="0.2"/>
        </pattern>
      </defs>
      <rect width="400" height="252" rx="16" fill="url(#cobaltBg)"/>
      <rect width="400" height="252" rx="16" fill="url(#cobaltGrid)"/>
      <circle cx="340" cy="40" r="120" fill="#38bdf8" opacity="0.12" filter="blur(20px)"/>
    `,
    chip: { x: 34, y: 95, type: "silver" },
    issuerLogoSvg: `
      <g transform="translate(34, 30)">
        <rect width="180" height="22" rx="3" fill="#002b66" stroke="#38bdf8" stroke-width="0.8" opacity="0.8"/>
        <text x="90" y="15" font-family="-apple-system, sans-serif" font-size="9.5" font-weight="900" fill="#ffffff" letter-spacing="1.5" text-anchor="middle">AMERICAN EXPRESS</text>
      </g>
    `,
    cardNameSvg: `
      <text x="34" y="222" font-family="-apple-system, sans-serif" font-size="20" font-weight="900" font-style="italic" fill="#ffffff" letter-spacing="-0.5">cobalt</text>
      <text x="98" y="222" font-family="-apple-system, sans-serif" font-size="10" font-weight="600" fill="#38bdf8">®</text>
    `,
    networkLogoSvg: `
      <g transform="translate(320, 195)">
        <rect width="52" height="32" rx="4" fill="#0047ab" stroke="#60a5fa" stroke-width="1"/>
        <text x="26" y="20" font-family="-apple-system, sans-serif" font-size="10" font-weight="900" fill="#ffffff" text-anchor="middle">AMEX</text>
      </g>
    `,
  },

  "amex-platinum": {
    bgSvg: `
      <defs>
        <linearGradient id="platBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f8fafc" />
          <stop offset="30%" stop-color="#e2e8f0" />
          <stop offset="60%" stop-color="#cbd5e1" />
          <stop offset="100%" stop-color="#94a3b8" />
        </linearGradient>
      </defs>
      <rect width="400" height="252" rx="16" fill="url(#platBg)"/>
      <rect x="14" y="14" width="372" height="224" rx="10" fill="none" stroke="#64748b" stroke-width="1.5" stroke-dasharray="3 3"/>
      
      <!-- Centurion Silhouette -->
      <g transform="translate(160, 80)" opacity="0.35">
        <ellipse cx="40" cy="42" rx="35" ry="42" fill="none" stroke="#334155" stroke-width="1.5"/>
        <circle cx="40" cy="40" r="28" fill="#475569" opacity="0.2"/>
        <path d="M 30 25 Q 40 15 50 25 Q 55 40 40 55 Q 25 40 30 25 Z" fill="#334155" opacity="0.4"/>
      </g>
    `,
    chip: { x: 34, y: 95, type: "silver" },
    issuerLogoSvg: `
      <text x="200" y="44" font-family="'Times New Roman', serif" font-size="13" font-weight="900" fill="#0f172a" letter-spacing="3" text-anchor="middle">AMERICAN EXPRESS</text>
    `,
    cardNameSvg: `
      <text x="34" y="220" font-family="-apple-system, sans-serif" font-size="11" font-weight="800" fill="#334155" letter-spacing="2">PLATINUM</text>
    `,
    networkLogoSvg: `
      <g transform="translate(320, 195)">
        <rect width="52" height="32" rx="4" fill="#1e293b"/>
        <text x="26" y="20" font-family="-apple-system, sans-serif" font-size="10" font-weight="900" fill="#ffffff" text-anchor="middle">AMEX</text>
      </g>
    `,
  },

  "td-aeroplan-visa-infinite": {
    bgSvg: `
      <defs>
        <linearGradient id="tdGreen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00843D" />
          <stop offset="50%" stop-color="#005A2B" />
          <stop offset="100%" stop-color="#022c22" />
        </linearGradient>
      </defs>
      <rect width="400" height="252" rx="16" fill="url(#tdGreen)"/>
      <path d="M 180 0 L 400 220 L 400 0 Z" fill="#ffffff" opacity="0.04"/>
    `,
    chip: { x: 34, y: 95, type: "silver" },
    issuerLogoSvg: `
      <g transform="translate(34, 30)">
        <rect width="32" height="32" rx="4" fill="#00843D" stroke="#22c55e" stroke-width="1.5"/>
        <text x="16" y="21" font-family="-apple-system, sans-serif" font-size="15" font-weight="900" fill="#ffffff" text-anchor="middle">TD</text>
      </g>
    `,
    cardNameSvg: `
      <g transform="translate(34, 185)">
        <text x="0" y="16" font-family="-apple-system, sans-serif" font-size="16" font-weight="800" fill="#ffffff">aeroplan</text>
        <circle cx="76" cy="6" r="3.5" fill="#dc2626"/>
        <text x="0" y="34" font-family="-apple-system, sans-serif" font-size="10" font-weight="700" fill="#86efac" letter-spacing="1">VISA INFINITE</text>
      </g>
    `,
    networkLogoSvg: `
      <g transform="translate(315, 195)">
        <text x="36" y="22" font-family="-apple-system, sans-serif" font-size="20" font-style="italic" font-weight="900" fill="#ffffff" text-anchor="middle">VISA</text>
        <text x="36" y="34" font-family="-apple-system, sans-serif" font-size="7" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">INFINITE</text>
      </g>
    `,
  },

  "scotia-gold-amex": {
    bgSvg: `
      <defs>
        <linearGradient id="scotiaGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#d97706" />
          <stop offset="35%" stop-color="#fbbf24" />
          <stop offset="70%" stop-color="#b45309" />
          <stop offset="100%" stop-color="#451a03" />
        </linearGradient>
      </defs>
      <rect width="400" height="252" rx="16" fill="url(#scotiaGold)"/>
      <path d="M 400 0 C 300 80, 260 180, 240 252" stroke="#dc2626" stroke-width="12" fill="none" opacity="0.75"/>
    `,
    chip: { x: 34, y: 95, type: "silver" },
    issuerLogoSvg: `
      <g transform="translate(34, 30)">
        <text x="0" y="16" font-family="-apple-system, sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="0.5">Scotiabank</text>
      </g>
    `,
    cardNameSvg: `
      <text x="34" y="218" font-family="-apple-system, sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="2">GOLD AMERICAN EXPRESS</text>
    `,
    networkLogoSvg: `
      <g transform="translate(320, 195)">
        <rect width="52" height="32" rx="4" fill="#78350f" stroke="#fbbf24" stroke-width="1"/>
        <text x="26" y="20" font-family="-apple-system, sans-serif" font-size="10" font-weight="900" fill="#ffffff" text-anchor="middle">AMEX</text>
      </g>
    `,
  },

  "scotia-momentum-vi-plus": {
    bgSvg: `
      <defs>
        <linearGradient id="momentumBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#9f1239" />
          <stop offset="50%" stop-color="#881337" />
          <stop offset="100%" stop-color="#4c0519" />
        </linearGradient>
      </defs>
      <rect width="400" height="252" rx="16" fill="url(#momentumBg)"/>
      <path d="M 0 120 Q 200 40 400 100" stroke="#f43f5e" stroke-width="3" fill="none" opacity="0.3"/>
    `,
    chip: { x: 34, y: 95, type: "silver" },
    issuerLogoSvg: `
      <text x="34" y="44" font-family="-apple-system, sans-serif" font-size="15" font-weight="900" fill="#ffffff">Scotiabank</text>
    `,
    cardNameSvg: `
      <text x="34" y="206" font-family="-apple-system, sans-serif" font-size="16" font-weight="800" font-style="italic" fill="#ffffff">Momentum</text>
      <text x="34" y="222" font-family="-apple-system, sans-serif" font-size="9" font-weight="700" fill="#fecdd3" letter-spacing="1.5">VISA INFINITE</text>
    `,
    networkLogoSvg: `
      <g transform="translate(315, 195)">
        <text x="36" y="22" font-family="-apple-system, sans-serif" font-size="20" font-style="italic" font-weight="900" fill="#ffffff" text-anchor="middle">VISA</text>
        <text x="36" y="34" font-family="-apple-system, sans-serif" font-size="7" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">INFINITE</text>
      </g>
    `,
  },

  "wealthsimple-vip": {
    bgSvg: `
      <defs>
        <linearGradient id="wsObsidian" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#18181b" />
          <stop offset="50%" stop-color="#09090b" />
          <stop offset="100%" stop-color="#000000" />
        </linearGradient>
      </defs>
      <rect width="400" height="252" rx="16" fill="url(#wsObsidian)"/>
      <line x1="34" y1="200" x2="366" y2="200" stroke="#d4af37" stroke-width="0.8" opacity="0.6"/>
    `,
    chip: { x: 34, y: 95, type: "silver" },
    issuerLogoSvg: `
      <text x="34" y="44" font-family="-apple-system, sans-serif" font-size="15" font-weight="600" fill="#ffffff" letter-spacing="0.5">Wealthsimple</text>
    `,
    cardNameSvg: `
      <text x="34" y="222" font-family="-apple-system, sans-serif" font-size="9" font-weight="700" fill="#d4af37" letter-spacing="2">VISA INFINITE PRIVILEGE</text>
    `,
    networkLogoSvg: `
      <g transform="translate(315, 195)">
        <text x="36" y="22" font-family="-apple-system, sans-serif" font-size="20" font-style="italic" font-weight="900" fill="#ffffff" text-anchor="middle">VISA</text>
        <text x="36" y="34" font-family="-apple-system, sans-serif" font-size="6" font-weight="700" fill="#d4af37" text-anchor="middle" letter-spacing="1">PRIVILEGE</text>
      </g>
    `,
  },

  "tangerine-moneyback-world": {
    bgSvg: `
      <defs>
        <linearGradient id="tangerineBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ea580c" />
          <stop offset="60%" stop-color="#c2410c" />
          <stop offset="100%" stop-color="#9a3412" />
        </linearGradient>
      </defs>
      <rect width="400" height="252" rx="16" fill="url(#tangerineBg)"/>
      <circle cx="340" cy="126" r="90" fill="#ffffff" opacity="0.08"/>
    `,
    chip: { x: 34, y: 95, type: "silver" },
    issuerLogoSvg: `
      <text x="34" y="46" font-family="-apple-system, sans-serif" font-size="18" font-weight="900" font-style="italic" fill="#ffffff">Tangerine</text>
    `,
    cardNameSvg: `
      <text x="34" y="206" font-family="-apple-system, sans-serif" font-size="13" font-weight="800" fill="#ffffff">Money-Back</text>
      <text x="34" y="220" font-family="-apple-system, sans-serif" font-size="9" font-weight="700" fill="#ffedd5" letter-spacing="1.5">WORLD MASTERCARD</text>
    `,
    networkLogoSvg: `
      <g transform="translate(320, 195)">
        <circle cx="16" cy="16" r="14" fill="#eb001b" opacity="0.9"/>
        <circle cx="34" cy="16" r="14" fill="#f79e1b" opacity="0.9"/>
      </g>
    `,
  },
};

function renderFullCardSvg(cardId: string, officialName: string, issuer: string, network: string): string {
  const custom = DESIGNS[cardId];
  if (custom) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 252" width="400" height="252">
      ${custom.bgSvg}
      
      <!-- Border outline -->
      <rect width="398" height="250" x="1" y="1" rx="15" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.2"/>
      
      <!-- Subtle top-down sheen -->
      <path d="M 0 0 L 250 0 L 150 252 L 0 252 Z" fill="#ffffff" opacity="0.04"/>

      <!-- EMV Chip -->
      <g transform="translate(${custom.chip.x}, ${custom.chip.y})">
        <rect width="44" height="34" rx="5" fill="${custom.chip.type === 'silver' ? 'url(#chipSilver)' : 'url(#chipGold)'}" stroke="#71717a" stroke-width="0.8"/>
        <line x1="15" y1="0" x2="15" y2="34" stroke="#52525b" stroke-width="0.7" opacity="0.6"/>
        <line x1="29" y1="0" x2="29" y2="34" stroke="#52525b" stroke-width="0.7" opacity="0.6"/>
        <line x1="0" y1="17" x2="44" y2="17" stroke="#52525b" stroke-width="0.7" opacity="0.6"/>
      </g>
      
      <!-- Contactless waves -->
      <g transform="translate(${custom.chip.x + 54}, ${custom.chip.y + 8})" stroke="#ffffff" stroke-width="1.8" fill="none" stroke-linecap="round" opacity="0.65">
        <path d="M 0 16 A 12 12 0 0 1 0 0"/>
        <path d="M 6 20 A 18 18 0 0 1 6 -4"/>
        <path d="M 12 24 A 24 24 0 0 1 12 -8"/>
      </g>

      ${custom.issuerLogoSvg}
      ${custom.cardNameSvg}
      ${custom.networkLogoSvg}
      
      <defs>
        <linearGradient id="chipSilver" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f4f4f5" />
          <stop offset="50%" stop-color="#d4d4d8" />
          <stop offset="100%" stop-color="#a1a1aa" />
        </linearGradient>
        <linearGradient id="chipGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#fde68a" />
          <stop offset="50%" stop-color="#fbbf24" />
          <stop offset="100%" stop-color="#d97706" />
        </linearGradient>
      </defs>
    </svg>`;
  }

  // Generic photorealistic template for all other cards
  const isMc = network.toLowerCase().includes("mastercard");
  const isAmex = network.toLowerCase().includes("amex");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 252" width="400" height="252">
    <defs>
      <linearGradient id="bg-${cardId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1e293b" />
        <stop offset="50%" stop-color="#0f172a" />
        <stop offset="100%" stop-color="#020617" />
      </linearGradient>
      <linearGradient id="chipSilver" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f4f4f5" />
        <stop offset="50%" stop-color="#d4d4d8" />
        <stop offset="100%" stop-color="#a1a1aa" />
      </linearGradient>
    </defs>
    <rect width="400" height="252" rx="16" fill="url(#bg-${cardId})"/>
    <rect width="398" height="250" x="1" y="1" rx="15" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.2"/>
    
    <!-- Issuer Name -->
    <text x="34" y="44" font-family="-apple-system, sans-serif" font-size="14" font-weight="700" fill="#ffffff" letter-spacing="0.5">${issuer}</text>
    
    <!-- Card Name -->
    <text x="34" y="218" font-family="-apple-system, sans-serif" font-size="13" font-weight="800" fill="#ffffff" letter-spacing="0.5">${officialName.length > 32 ? officialName.slice(0, 30) + '…' : officialName}</text>
    
    <!-- Chip -->
    <g transform="translate(34, 95)">
      <rect width="44" height="34" rx="5" fill="url(#chipSilver)" stroke="#71717a" stroke-width="0.8"/>
      <line x1="15" y1="0" x2="15" y2="34" stroke="#52525b" stroke-width="0.7" opacity="0.6"/>
      <line x1="29" y1="0" x2="29" y2="34" stroke="#52525b" stroke-width="0.7" opacity="0.6"/>
      <line x1="0" y1="17" x2="44" y2="17" stroke="#52525b" stroke-width="0.7" opacity="0.6"/>
    </g>

    <!-- Network -->
    ${isMc ? `
      <g transform="translate(320, 195)">
        <circle cx="16" cy="16" r="14" fill="#eb001b" opacity="0.9"/>
        <circle cx="34" cy="16" r="14" fill="#f79e1b" opacity="0.9"/>
      </g>
    ` : isAmex ? `
      <g transform="translate(320, 195)">
        <rect width="52" height="32" rx="4" fill="#0047ab" stroke="#60a5fa" stroke-width="1"/>
        <text x="26" y="20" font-family="-apple-system, sans-serif" font-size="10" font-weight="900" fill="#ffffff" text-anchor="middle">AMEX</text>
      </g>
    ` : `
      <g transform="translate(320, 195)">
        <text x="32" y="20" font-family="-apple-system, sans-serif" font-size="19" font-style="italic" font-weight="900" fill="#ffffff" text-anchor="middle">VISA</text>
      </g>
    `}
  </svg>`;
}

console.log("Generating photorealistic cards for", cardCatalogue.cards.length, "cards...");

for (const card of cardCatalogue.cards) {
  const svg = renderFullCardSvg(card.cardId, card.officialName, card.issuer, card.network);
  const svgPath = path.join(outputDir, `${card.cardId}.svg`);
  const webpPath = path.join(outputDir, `${card.cardId}.webp`);
  fs.writeFileSync(svgPath, svg, "utf-8");
  fs.writeFileSync(webpPath, svg, "utf-8");
}

console.log("Done!");
