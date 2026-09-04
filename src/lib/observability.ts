import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

const tracer = trace.getTracer("in-unity");
const meter = metrics.getMeter("in-unity");

// These are deliberately evaluation counters, not unique-email counters. The
// email scan may revisit an already-ingested message and we retain no
// per-message telemetry state by design.
const obligationFactContextEvaluations = meter.createCounter(
  "email.obligation_fact.context.evaluations",
  { description: "Obligation-context email fact extraction evaluations" },
);
const obligationFactNearMissEvaluations = meter.createCounter(
  "email.obligation_fact.near_miss.evaluations",
  { description: "Obligation-context evaluations that emitted no fact" },
);
const obligationFactNearMissReasons = meter.createCounter(
  "email.obligation_fact.near_miss.reasons",
  { description: "Reasons an obligation-context evaluation emitted no fact" },
);
const legacySubscriptionAdapterRequests = meter.createCounter(
  "subscription.compatibility_adapter.requests",
  { description: "Requests to the deprecated subscription compatibility API" },
);
const subscriptionNotificationOutcomes = meter.createCounter(
  "subscription.migration.notifications",
  { description: "Canonical subscription notification scheduling outcomes during the migration window" },
);
const subscriptionDataOperationOutcomes = meter.createCounter(
  "subscription.migration.data_operations",
  { description: "Subscription-aware export and deletion outcomes during the migration window" },
);
const recurringSweepOutcomes = meter.createCounter(
  "subscription.migration.sweep_outcomes",
  { description: "Recurring sweep persistence outcomes used to verify idempotency" },
);
const communityMerchantMCCSubmissionOutcomes = meter.createCounter(
  "community.merchant_mcc.submissions",
  { description: "Anonymous community merchant-MCC submission outcomes" },
);
const communityMerchantMCCQueryOutcomes = meter.createCounter(
  "community.merchant_mcc.queries",
  { description: "Anonymous community merchant-MCC query and health outcomes" },
);
const communityMerchantMCCQueryVolume = meter.createCounter(
  "community.merchant_mcc.query_volume",
  { description: "Aggregate candidate and published-signal counts for community MCC queries" },
);

export type ObligationFactNearMissReason =
  | "NO_SUPPORTED_FACT_LANGUAGE"
  | "CADENCE_WITHOUT_BILLING_OPERATION"
  | "NEXT_BILLING_DATE_UNPARSEABLE";

type ObligationFactEvaluation = "EMITTED_FACT" | "NEAR_MISS";

type ObligationFactMetricAttributes = {
  "email.obligation_fact.known_conduit": boolean;
};

/**
 * Record aggregate-only fact-lane coverage. Never add message identifiers,
 * sender/merchant values, subjects, snippets, or body text here: telemetry is
 * not an email evidence store.
 */
export function recordObligationFactEvaluation(
  outcome: ObligationFactEvaluation,
  knownConduit: boolean,
  reasons: readonly ObligationFactNearMissReason[] = [],
): void {
  const attributes: ObligationFactMetricAttributes = {
    "email.obligation_fact.known_conduit": knownConduit,
  };
  obligationFactContextEvaluations.add(1, { ...attributes, "email.obligation_fact.outcome": outcome });

  if (outcome !== "NEAR_MISS") return;

  obligationFactNearMissEvaluations.add(1, attributes);
  for (const reason of reasons) {
    obligationFactNearMissReasons.add(1, {
      ...attributes,
      "email.obligation_fact.reason": reason,
    });
  }
}

export type LegacySubscriptionAdapterRoute =
  | "collection"
  | "item"
  | "confirm-detection";

type LegacySubscriptionCaller =
  | "browser-same-origin"
  | "browser-cross-origin"
  | "browser-unknown-origin"
  | "command-line"
  | "api-client"
  | "automation"
  | "other"
  | "unknown";

/**
 * Keep caller attribution bounded. Raw user-agent and referrer values are both
 * high-cardinality and can contain identifying data, so they must never become
 * metric attributes. This classification is diagnostic only; request count is
 * the retirement gate.
 */
function legacySubscriptionCaller(request?: Pick<Request, "headers">): LegacySubscriptionCaller {
  if (!request) return "unknown";
  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase() ?? "";

  if (userAgent.includes("qstash") || userAgent.includes("vercel-cron")) return "automation";
  if (userAgent.includes("curl") || userAgent.includes("wget") || userAgent.includes("httpie")) return "command-line";
  if (userAgent.includes("postman") || userAgent.includes("insomnia")) return "api-client";
  if (userAgent.includes("mozilla")) {
    if (fetchSite === "same-origin" || fetchSite === "same-site") return "browser-same-origin";
    if (fetchSite === "cross-site") return "browser-cross-origin";
    return "browser-unknown-origin";
  }
  return userAgent ? "other" : "unknown";
}

export function recordLegacySubscriptionAdapterRequest(args: {
  request?: Pick<Request, "headers">;
  route: LegacySubscriptionAdapterRoute;
  method: "GET" | "POST" | "PATCH";
}): void {
  legacySubscriptionAdapterRequests.add(1, {
    "subscription.adapter.route": args.route,
    "subscription.adapter.method": args.method,
    "subscription.adapter.caller": legacySubscriptionCaller(args.request),
  });
}

export type SubscriptionNotificationOutcome = "scan-batch" | "scanned" | "scheduled" | "failed";

export function recordSubscriptionNotificationOutcome(
  outcome: SubscriptionNotificationOutcome,
  count = 1,
): void {
  if (count <= 0) return;
  subscriptionNotificationOutcomes.add(count, { "subscription.notification.outcome": outcome });
}

export type SubscriptionDataOperation = "export" | "delete";
export type SubscriptionDataOperationOutcome = "success" | "failure" | "partial";

export function recordSubscriptionDataOperation(args: {
  operation: SubscriptionDataOperation;
  outcome: SubscriptionDataOperationOutcome;
  scope?: "data" | "account";
}): void {
  subscriptionDataOperationOutcomes.add(1, {
    "subscription.data.operation": args.operation,
    "subscription.data.outcome": args.outcome,
    ...(args.scope ? { "subscription.data.scope": args.scope } : {}),
  });
}

export type RecurringSweepOutcome = "completed" | "created" | "updated" | "unchanged" | "skipped" | "failed";

export function recordRecurringSweepOutcome(outcome: RecurringSweepOutcome, count = 1): void {
  if (count <= 0) return;
  recurringSweepOutcomes.add(count, { "recurring.sweep.outcome": outcome });
}

export type CommunityMerchantMCCSubmissionOutcome =
  | "accepted"
  | "duplicate"
  | "capped"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_observation"
  | "observation_time_out_of_range"
  | "failed";

/**
 * Community MCC telemetry is intentionally aggregate-only. Never add merchant ids, MCCs,
 * coordinates, place ids, observation UUIDs, user/device/account ids, IPs, or raw headers as
 * attributes here. Those would turn operational metrics into another tracking surface.
 */
export function recordCommunityMerchantMCCSubmission(
  outcome: CommunityMerchantMCCSubmissionOutcome,
): void {
  communityMerchantMCCSubmissionOutcomes.add(1, {
    "community.merchant_mcc.submission.outcome": outcome,
  });
}

export type CommunityMerchantMCCQueryOutcome =
  | "success"
  | "health_success"
  | "health_failed"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_query"
  | "failed";

export function recordCommunityMerchantMCCQuery(args: {
  outcome: CommunityMerchantMCCQueryOutcome;
  candidates?: number;
  signals?: number;
}): void {
  communityMerchantMCCQueryOutcomes.add(1, {
    "community.merchant_mcc.query.outcome": args.outcome,
  });
  if ((args.candidates ?? 0) > 0) {
    communityMerchantMCCQueryVolume.add(args.candidates!, {
      "community.merchant_mcc.query.volume_kind": "candidates",
    });
  }
  if ((args.signals ?? 0) > 0) {
    communityMerchantMCCQueryVolume.add(args.signals!, {
      "community.merchant_mcc.query.volume_kind": "signals",
    });
  }
}

export async function withSpan<T>(
  name: string,
  operation: (span: Span) => Promise<T>,
  attributes?: Attributes,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await operation(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
