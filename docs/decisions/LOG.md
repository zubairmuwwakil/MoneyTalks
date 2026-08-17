# Decision log

One line per settled decision, newest first. Agents: check here before treating any question as open; add a line whenever the owner ratifies something in chat.

- 2026-08-17 — Cross-source merge: observations (WalletEvent/EmailTransaction) link to one canonical Purchase; exact = amount + 72h window + merchant-compatible → enrich, never duplicate; amount+time alone → `possibleDuplicateOfId` flag, never a silent merge; cap accrual keyed `purchase:{id}` for exactly-once across sources (closes a latent double-count).

- 2026-08-17 — Working mode: agents proceed autonomously; discussion reserved for high-ROI / hard-to-reverse decisions, batched into one question set; token-conscious.
- 2026-08-17 — Build sequence: multi-user foundations → cross-source purchase merge (incl. email ingestion) → transactions experience → optimizer/money-back UX polish. All three loops matter equally; ordering is by dependency.
- 2026-08-17 — First real users: friends/family within weeks, gated by `ALLOWED_EMAILS`.
- 2026-08-17 — Allowlist enforced on every session resolution (removal revokes an existing account), not just at signup; empty/unset list never locks out existing accounts.
- 2026-08-17 — Location retention: keep precise purchase coordinates for now (the reversible choice); make the deliberate privacy policy before any public launch.
- 2026-08-17 — `CardAlias` is per-user (same raw string ≠ same card across users); `MerchantAlias` stays global on purpose (merchant identity is universal, shared learning).
- 2026-08-17 — OwnerStateRecord auto-provisions on first use from the user's contract-linked CreditCard rows: floor point valuations, conservative "both" switch threshold, empty cardStates (engine safely refuses unresolved rules). Hand-curated state remains possible via `scripts/seed-owner-state.ts <email>`.
- 2026-08-17 — Wallet capture is complete-record: `capturedAtRaw` + `capturedTimezone` + `Decimal` amounts + `rawPayload` persisted; Shortcut stays a dumb transport; server absorbs all serialization quirks.
- 2026-08-17 — Shortcut outbox deletes queued files on any 4xx too (poison-file rule), not just 2xx/duplicate.
- 2026-08-16 — One money app: MoneyTalks absorbs return-saas + PickMe (see `2026-08-16-one-money-app.md` in ../MoneyTalks decision record referenced from return-saas).
