# FinnLens and Subflo: capability review

**Generated:** 2026-08-30 · **Decision:** `docs/decisions/2026-08-30-email-fact-lane.md`

Supporting detail for the ratified decision to take no code from either
repository. Both were read at source. Ratings describe what the code does, not
what the README claims.

## 1. Capability matrix

Strong / Medium / Weak / Absent.

| Capability | MoneyTalks | FinnLens | Subflo |
|---|---|---|---|
| Gmail ingestion | **Strong** — OAuth, scope verification, query narrowing, backfill, reprocess | **Strong** — OAuth, sync jobs, sender rules, pipeline steps | **Medium** — OAuth plus an IMAP path; no scope verification |
| Other mail sources | **Weak** — `EmailProvider` is `GMAIL \| UPLOAD` only | Absent | **Medium** — Outlook and generic IMAP |
| SMS ingestion | Absent | Absent | **Medium** — India-shaped (UPI, "A/c XX1234"), LLM-parsed |
| MIME parsing | **Strong** — `mailparser.simpleParser` over raw RFC822 | **Weak** — receives a body string; no MIME layer | **Weak** — Gmail payload walk, no MIME decode |
| HTML normalization | **Strong** — cheerio plus a purpose-built `htmlToText` | **Weak** — `re.sub(r"<[^>]+>", " ")` | **Weak** — regex `stripHtml` |
| JSON-LD commerce parsing | **Strong** — schema.org Order extraction, treated as self-declaring evidence | Absent | Absent |
| PDF parsing | **Medium** — `pdf-parse` over attachments; text totals only, no line items | **Strong** — per-issuer parsers, password handling, line-item extraction | Absent |
| Transaction detection | **Strong** — `hasPurchaseEvidence`, explicit prospective-charge and refund exclusions | **Medium** — regex per data type | **Weak** — LLM decides `is_subscription` |
| Bill detection | **Medium** — `classifyReceiptEmail` returns `BILL`; no amount-due extraction | **Medium** — dedicated bill parser | Absent |
| Credit-card statement extraction | Absent — `StatementLine` written only by manual reconcile | **Strong for India** — balance, minimum, due date, period, PDF password | Absent |
| Bank statement extraction | Absent | **Medium** — dedicated parser | Absent |
| Subscription detection | **Strong** — clustering plus explicit email signals | **Weak** — keyword parser | **Medium** — LLM extraction with a pre-filter |
| Recurring pattern inference | **Strong** — cadence inference with coverage and MAD, six cadences, amount patterns | **Weak** — interval grouping | **Weak** — an LLM prompt asked to find patterns |
| Merchant normalization | **Strong** — merchant pack, longest-key matching, word-boundary and lead-position rules, conduits, global alias table | **Weak** — issuer inference from sender domain | **Weak** — 60 hardcoded regex-to-name pairs |
| Currency detection | **Strong** — six-tier ladder with a persisted `currencySource` per row | Absent — `currency = "INR"` | **Weak** — LLM field, `@default("INR")` |
| Lifecycle events | **Medium** — seven fact types derived correctly, but from subject lines and never persisted | **Weak** | **Medium** — an `action` field the LLM fills |
| Trial detection | **Medium** — start and end facts, subject-only in practice | Absent | **Medium** — LLM-reported |
| Price-change detection | **Medium** — fact type with amount, subject-only in practice | Absent | **Medium** — LLM-reported |
| Cancellation detection | **Medium** — fact plus a `CANCELLING`/`CANCELLED` distinction with effective dates | Absent | **Medium** — LLM-reported |
| Cross-source reconciliation | **Strong** — email, wallet tap and statement line merge onto one `Purchase`; RFC822 id distinguishes one receipt twice from two receipts | Absent | Absent |
| Confidence scoring | **Strong** — typed reason codes, one frozen weights table, display-ready explanations | **Weak** — literals such as `confidence=0.8` | **Medium** — a 0–100 signal score plus an LLM high/medium/low |
| Auditability | **Strong** — evidence links, correction log with undo, `currencySource`, `categorySource`, parser and algorithm versions | **Weak** — pipeline steps only | **Weak** — stores the receipt HTML, no reasoning |
| Privacy posture | **Strong** — no bodies stored, encrypted account numbers, export and cascade delete | **Medium** — stores extracted data, encrypts tokens | **Weak** — `Receipt.htmlContent` stores full email HTML |
| LLM dependency | **Strong** (none) | **Strong** (none in the email path) | **Weak** — required for extraction |
| Extensibility | **Medium** — tiered resolvers and versioned parsers, but `gmailReceiptProcessing` is 794 lines | **Medium** — parser registry, though first-match-wins | **Weak** — swapping models, not parsers |
| Canadian support | **Strong** — merchant pack is Canadian, Payments Canada CCINs, CAD default | Absent | Absent |
| US support | **Medium** — currency and merchants work; no US-specific biller data | Absent | **Weak** — incidental |

Where FinnLens genuinely leads: **statement PDF handling.** Password-protected
statements with per-issuer line-item parsers is real capability, not an
India-specific regex. It is also precisely the deferred item, and the deferral
is a corpus problem rather than a design problem.

Where Subflo genuinely leads: **ingestion surface.** Outlook and IMAP are absent
here and are not India-specific. Worth noting as a real gap; unrelated to the
fact lane.

## 2. Subflo's schema: what MoneyTalks does not retain

The brief asked for the exact missing fields. Comparing Subflo's `Subscription`
and its extraction result against every MoneyTalks model:

| Subflo field | MoneyTalks | Verdict |
|---|---|---|
| `serviceName` | `Purchase.merchant`, canonical via the pack | Retained, better |
| `amount` / `currency` | Minor units plus `currencySource` | Retained, better — Subflo uses `Float` for money |
| `billingCycle` | `RecurringObligation.cadence` | Retained, richer |
| `category` | `Purchase.category` plus `categorySource` | Retained, better |
| `status` | Derived per sweep, never a mutable column | Retained by design |
| `confidence` | Score plus typed reasons | Retained, better |
| **`planName`** | Nowhere | **Missing** |
| **`cardLast4`** | Only `CreditCard.lastFour`, owner-entered; never captured from mail | **Missing** |
| **`nextRenewal` as stated** | Only `nextExpectedDate`, which is *projected* | **Missing, and conflated** — a merchant's stated date and a computed one are different claims |
| **`action` per event** | Derived at sweep time, never persisted | **Missing** |
| **`paymentMethod`** | `Purchase.paymentMethod` exists; nothing on the obligation | **Partial** |
| **`autoRenew`** | `EXPLICIT_RECURRING` derived, not persisted | **Missing** |
| **`startedAt`** | Nowhere; earliest evidence is inferred | **Missing** |
| **`rejectionReason`** | Nothing records *why* an email produced no fact | **Missing** |

`planName`, `cardLast4`, the stated renewal date and the per-event action are
all addressed by `EmailObligationFact`. Three are not, and are recorded here
rather than silently dropped:

- **`autoRenew`** is representable as an `EXPLICIT_RECURRING` fact and needs no
  column.
- **`startedAt`** should stay derived. A stored start date would be a second,
  drifting statement of what the evidence already says.
- **`rejectionReason` is the one worth reconsidering.** For a system whose
  stated principle is explainability, having no record of "this email was seen
  and deliberately produced nothing, because X" is a real hole. `parserError`
  captures crashes, not reasoned refusals. Deliberately out of scope for the
  fact lane; noted for a later decision. Subflo, an LLM-first tool, models this
  better than we do.

## 3. Deferred: CA/US issuer coverage sketch

Recorded so the deferral is a decision with a shape, not an absence. **Not
scheduled.** Blocked per the decision record on the absence of a real corpus.

Ordered by how much of a typical Canadian wallet each issuer covers rather than
alphabetically, since coverage is what makes the work worth starting:

- **Tier 1 (Canada):** TD, RBC, Scotiabank, BMO, CIBC, American Express Canada.
- **Tier 2 (Canada):** MBNA, Tangerine, Desjardins, National Bank, Rogers Bank,
  Canadian Tire Bank.
- **Tier 1 (US):** Chase, American Express, Capital One, Citi, Bank of America,
  Discover.

Design constraints that would apply whenever it unblocks:

1. **Issuer identity is not merchant identity.** An issuer registry is separate
   from the merchant pack. A statement from a bank is not a purchase at that
   bank, and collapsing the two would let statement mail resolve to a merchant
   and contaminate purchase clustering.
2. **A statement fact is not a transaction.** It states a balance, not a charge.
   It must never reach `hasPurchaseEvidence`.
3. **Extract only what is unambiguous.** "Payment of $X due DATE" is close to
   universal wording. Statement balance, minimum payment and billing period vary
   far more, and a wrong balance is worse than an absent one.
4. **Reconciliation is by `(issuer, cardLast4, period)`,** not by amount. Amounts
   repeat; a statement period does not.
5. **PDF handling is a second phase.** Email-body extraction first, attachments
   only once body extraction is trustworthy. FinnLens's password callback is the
   right shape to borrow *as a shape*: the password is derived per issuer and
   supplied by a caller, never stored beside the document.

The unblocking condition remains as stated in the decision record: a private
fixture corpus outside this repository, or a runtime-only capture path that
never enters git.
