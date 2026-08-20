import type { Metadata } from "next";
import { MarketingContent } from "@/components/marketing/marketing-content";

export const metadata: Metadata = {
  title: "In Unity — Personal Finance Command Center & Ambient Card Copilot",
  description:
    "Max out card rewards at checkout, track multi-currency net worth, project 12-month bill cashflow, and catch expiring return windows and cross-border tax compliance triggers.",
  openGraph: {
    title: "In Unity — Personal Finance Command Center & Ambient Card Copilot",
    description:
      "Max out rewards on every swipe without thinking. 100% private, on-device card picks, cashflow forecasting, and cross-border compliance.",
    url: "https://inunity.ca/marketing",
    siteName: "In Unity",
    locale: "en_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "In Unity — Personal Finance Command Center & Ambient Card Copilot",
    description:
      "Max out rewards on every swipe without thinking. 100% private, on-device card picks, and multi-currency tracking.",
  },
};

export default function MarketingPage() {
  return <MarketingContent />;
}

