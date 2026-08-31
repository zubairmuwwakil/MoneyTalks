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
