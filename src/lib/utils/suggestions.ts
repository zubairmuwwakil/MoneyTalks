export type SuggestionType = "RETURN" | "SUBSCRIPTION" | "BILL";

export type SuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type SuggestionProvider = "gmail" | "outlook";

export type SuggestionDraft = {
  // Return
  purchaseDate?: string;
  returnBy?: string;
  returnWindowDays?: number;
  trackingNumber?: string;
  carrier?: string;
  refundSlaDays?: number;
  refundExpectedAt?: string;
  refundType?: "ORIGINAL" | "STORE_CREDIT" | "PARTIAL";
  deliveredAt?: string;

  // Subscription
  renewalDate?: string;
  cadence?: "MONTHLY" | "YEARLY";

  // Bill
  dueDayOfMonth?: number;
  autopay?: boolean;
};

export type SuggestionSource = {
  provider: SuggestionProvider;
  messageIds: string[];
};

export type Suggestion = {
  id: string;
  type: SuggestionType;
  merchant: string;
  amountCents?: number;
  currency: "CAD";
  detectedDate: string; // YYYY-MM-DD
  confidence: SuggestionConfidence;
  reasons: string[];
  source: SuggestionSource;
  draft: SuggestionDraft;
};
