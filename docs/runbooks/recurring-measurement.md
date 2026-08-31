# Recurring-obligation measurement

This is the P8 evaluation workflow for the judgement-chosen weights in
`src/lib/domain/recurring/confidence.ts`. It measures without tuning and never
writes to the database. PostgreSQL enforces a read-only transaction; local
labels live under `docs/private/`, which is gitignored because merchant history
is personal data.

## Why there are two label passes

A merchant label answers whether the detector found the right *merchant*. It
cannot decide whether two series at that merchant are both real. Conversely,
labels on detected series can measure precision but cannot expose obligations
the detector never created.

The workflow therefore keeps two quantities separate:

1. A blind merchant pass measures merchant-level recall. It shows purchase
   count, span, interval median/MAD, and amount spread, but deliberately hides
   detector output until every merchant is labelled.
2. A detected-series pass measures series precision and per-signal
   contribution. It is unlocked only after the blind pass is complete.

Neither quantity is called obligation-level recall. Measuring that would need
the owner to enumerate every independent series, not merely every recurring
merchant.

## Run it

Generate or refresh the blind sheet. Existing labels and notes are preserved
by merchant identity:

```sh
npx tsx --conditions=react-server scripts/ops/reportRecurringMeasurement.ts --prepare-merchants
```

Fill `recurring_label` with `yes` or `no`. `uncertain` is allowed as a working
mark but intentionally blocks metrics. The rows are ordered by a review score
computed only from raw interval proximity and MAD; the score is not exported
and is not a second detector.

After all merchant labels are yes/no, generate the detected-series sheet:

```sh
npx tsx --conditions=react-server scripts/ops/reportRecurringMeasurement.ts --prepare-series
```

Fill `series_label` with `yes` or `no`. Refreshing this sheet preserves labels
by the detector's durable `seriesKey`.

Print the report:

```sh
npx tsx --conditions=react-server scripts/ops/reportRecurringMeasurement.ts --report
```

When multiple owners have purchases, every command refuses to mix them and
requires `--user <userId>`. Use `--output <directory>` to override the default
`docs/private/recurring-evaluation/<userId>/` location.

## Interpretation rules

- Merchant precision/recall is computed only when every current merchant is
  yes/no.
- Series precision and per-signal prevalence are computed only when every
  current detected series is yes/no.
- Decision-stream precision counts confirmation as true and dismissals for
  `not-recurring` or `duplicate` as false. `not-interested` is a preference,
  not a truth label; an `other` dismissal is ambiguous. Both stay visible but
  out of the denominator.
- The decision stream is always labelled precision-only and recall-blind.
- A confidence curve is suppressed below 30 evaluable decisions or four
  occupied score buckets. Three detections and two scores are not a curve.
- Per-signal output is descriptive. Do not drop or retune a term on one inbox;
  this phase reports evidence and changes no detection code.

## Proposed target, not policy

The report proposes at least **90% detected-series precision over at least 50
independently labelled series**, with a confidence interval shown. A false row
costs trust in the rest of the review queue, so precision is the launch bar.
The owner must ratify or replace this number before it becomes a threshold.
