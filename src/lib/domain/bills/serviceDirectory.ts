export interface KnownServiceProfile {
  id: string;
  displayName: string;
  pattern: RegExp;
  serviceUrl: string;
  category: string;
  spendCategory: string;
  paymentRail: "card" | "pad" | "card_via_third_party" | "unknown";
}

/**
 * Small, high-confidence service directory for manual bill capture. This is
 * deliberately separate from PickMe's merchant pack: In Unity owns bill and
 * subscription account metadata, while PickMe owns card-decision facts.
 */
export const KNOWN_SERVICES: readonly KnownServiceProfile[] = [
  {
    id: "netflix",
    displayName: "Netflix",
    pattern: /\bnetflix\b/i,
    serviceUrl: "https://www.netflix.com/account",
    category: "subscriptions:streaming",
    spendCategory: "streaming",
    paymentRail: "card",
  },
  {
    id: "spotify",
    displayName: "Spotify",
    pattern: /\bspotify\b/i,
    serviceUrl: "https://www.spotify.com/account/overview/",
    category: "subscriptions:streaming",
    spendCategory: "streaming",
    paymentRail: "card",
  },
  {
    id: "disney-plus",
    displayName: "Disney+",
    pattern: /\bdisney\s*(?:\+|plus)\b/i,
    serviceUrl: "https://www.disneyplus.com/",
    category: "subscriptions:streaming",
    spendCategory: "streaming",
    paymentRail: "card",
  },
  {
    id: "crave",
    displayName: "Crave",
    pattern: /\bcrave\b/i,
    serviceUrl: "https://www.crave.ca/",
    category: "subscriptions:streaming",
    spendCategory: "streaming",
    paymentRail: "card",
  },
  {
    id: "youtube-premium",
    displayName: "YouTube Premium",
    pattern: /\byoutube(?:\s+premium)?\b/i,
    serviceUrl: "https://www.youtube.com/paid_memberships",
    category: "subscriptions:streaming",
    spendCategory: "streaming",
    paymentRail: "card",
  },
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    pattern: /\b(?:chatgpt|openai)\b/i,
    serviceUrl: "https://chatgpt.com/",
    category: "subscriptions:software_saas",
    spendCategory: "digitalMedia",
    paymentRail: "card",
  },
  {
    id: "adobe",
    displayName: "Adobe",
    pattern: /\badobe\b/i,
    serviceUrl: "https://account.adobe.com/",
    category: "subscriptions:software_saas",
    spendCategory: "digitalMedia",
    paymentRail: "card",
  },
  {
    id: "github",
    displayName: "GitHub",
    pattern: /\bgithub\b/i,
    serviceUrl: "https://github.com/settings/billing",
    category: "subscriptions:software_saas",
    spendCategory: "digitalMedia",
    paymentRail: "card",
  },
];

export function findKnownService(...values: Array<string | null | undefined>): KnownServiceProfile | null {
  const query = values.filter(Boolean).join(" ").trim();
  if (!query) return null;
  return KNOWN_SERVICES.find((service) => service.pattern.test(query)) ?? null;
}
