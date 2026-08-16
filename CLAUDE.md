# Project rules (ratified — do not relitigate in-session)

Decision record: docs/decisions/2026-08-16-one-money-app.md

- **The card engine in `src/engine/cards/` is FROZEN.** Bug fixes only. Do not add rule-model features, categories, or picker capabilities — card semantics are owned by PickMe's engine and a shared catalogue/fixture contract. This engine is scheduled for deletion in Phase 1.
- MoneyTalks is the web money hub of a unified product (with PickMe iOS + absorbed return-saas pieces). Check the decision record before any cross-cutting work.

@AGENTS.md
