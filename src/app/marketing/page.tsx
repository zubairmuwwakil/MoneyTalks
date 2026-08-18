import type { Metadata } from "next";
import { MarketingContent } from "@/components/marketing/marketing-content";

export const metadata: Metadata = {
  title: "PickMe — Personal Finance Command Center & Ambient Card Copilot",
  description:
    "Max out card rewards at checkout, track multi-currency net worth, project 12-month bill cashflow, and catch expiring return windows and cross-border tax compliance triggers.",
};

export default function MarketingPage() {
  return <MarketingContent />;
}
