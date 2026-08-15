# MoneyTalks LinkedIn Post and Visual Design

**Date:** 2026-08-15

**Status:** Approved

**Primary audience:** Recruiters and hiring managers

**Secondary audience:** Developers and founders

## Objective

Create a personal, credible LinkedIn launch/build-in-public post that explains why MoneyTalks exists and demonstrates product judgment. The post should make the product memorable without claiming unfinished capabilities or presenting financial estimates as professional advice.

The intended reader takeaway is:

> MoneyTalks combines financial facts with personal circumstances to explain what someone should consider doing with their next available dollar—and why the answer changes.

## Approved Story Strategy

Three positioning approaches were considered:

1. **Personalized next-dollar decision (selected).** Lead with the human problem, show how context changes the answer, and use the monthly allocation decision as the concrete outcome. This is the clearest balance of personal motivation, product differentiation, and engineering depth.
2. **Context-aware financial command center.** Lead with tracking bills, cards, investments, and profile information in one place. This is accurate but less differentiated and risks sounding like a feature catalogue.
3. **Deterministic personal-finance rules engine.** Lead with versioned rules, citations, and calculation logic. This supports developer credibility but does not communicate the personal reason for building the product strongly enough.

The post will use approach 1. Approaches 2 and 3 will appear only as supporting evidence.

## Narrative Spine

The central contrast is:

> Two people can have the same income, bills, card balance, investments, and available cash—and still need different guidance.

MoneyTalks will be explained as four connected layers:

1. **Financial facts:** income, upcoming bills, card balances, interest rates, investments, contribution room, and available cash.
2. **Personal context:** residency, citizenship, disability eligibility, household circumstances, benefits, and account eligibility.
3. **Personalized decision:** what to pay down, contribute, or keep liquid this month.
4. **Explanation:** which circumstances changed the result, what assumptions were used, and the estimated financial effect.

Personal context must be presented as an input to the result, not as a profile checklist. The post should explicitly show that adding or changing context can change account treatment, grant or benefit opportunities, affordability, or the priority between liquidity, debt, and contributions.

## Personal Origin

The personal motivation will be specific enough to feel genuine but will not disclose private financial, disability, military, citizenship, or family details.

Approved framing:

> I started building MoneyTalks because I wanted one place that understood not only my finances, but the circumstances that make those numbers mean something.

The post must not invent a personal hardship, diagnosis, citizenship status, debt amount, or other biographical detail.

## North-Star Product Question

The roadmap will be organized around one memorable question:

> Given my income, bills, debt, account room, and personal circumstances, what should my next $500 do—and why?

The `$500` amount is illustrative. It makes the outcome concrete without implying that every user has exactly that amount available.

The future decision view should compare actions such as:

- keep cash available to protect upcoming bills and an emergency floor;
- make required minimum payments and allocate additional cash to debt;
- capture an eligible employer match, grant, or bond;
- contribute to an eligible registered account when room and tax treatment are verified; or
- abstain from recommending an allocation when essential inputs are missing or stale.

Every result should identify the context that mattered and explain trade-offs rather than issue a bare command.

## Claim Boundary: Built Versus Planned

The post must distinguish the current product from the product direction.

### Built and safe to show

- investment accounts, balances, transactions, snapshots, and currency conversion;
- recurring bills, payment tracking, upcoming payments, month totals, and bill forecasts;
- profile inputs including residency, citizenship, selected eligibility details, benefit programs, contribution room, and income sources;
- the first deterministic Money Finder rules, including room and selected benefit, cross-border, and RDSP logic;
- rule explanations, citations, failure isolation, and source-freshness warnings;

### Planned and labeled as next

- implemented credit-card and debt balances, APRs, minimum payments, due dates, promotional terms, and payoff schedules;
- a verified spendable-surplus calculation using net income, bills, minimum payments, spending reserve, and emergency-cash floor;
- side-by-side debt, liquidity, grant, and contribution scenarios;
- a comprehensive tax-and-benefit effect calculator;
- a single constrained allocation plan across competing recommendations.

The post must not imply that Cards, full debt payoff guidance, complete household tax optimization, or the next-dollar allocator already work.

## Financial Wording Guardrails

- Do not say “invest enough to change tax brackets.” Canadian tax rates are marginal, and each rate applies only to the corresponding portion of taxable income.
- Use “estimated effect,” “decision support,” or “scenario” rather than “optimal,” “exact,” “guaranteed,” or “highest-ROI anywhere.”
- Distinguish a tax deduction, estimated tax change, refund timing, benefit change, grant or bond, and future withdrawal taxation.
- Never describe an RRSP, FHSA, TFSA, or RDSP contribution as safe without verified room and the relevant eligibility inputs.
- Do not present an RDSP as ordinary emergency liquidity.
- For cross-border users, avoid unconditional “tax-free” language and identify when professional review is appropriate.
- Protect essentials, required minimum payments, and an explicit liquidity floor before describing money as available.
- Do not call the current bill-only forecast a cash-flow forecast.
- Do not call asset-only balances net worth while liabilities remain unimplemented.

## Post Structure

Target length: approximately 220–300 words.

1. **Hook:** Same financial facts can require different decisions.
2. **Personal reason:** Explain the desire for software that understands both the numbers and the circumstances behind them.
3. **Problem:** Most tools track accounts or transactions before understanding context.
4. **Product thesis:** Financial facts plus personal context should produce an explainable decision.
5. **One contrast:** Use one compact, hypothetical example showing how eligibility, residency/citizenship, income, benefits, debt cost, or liquidity can change the analysis. Avoid a long list of personas or tax rules.
6. **Working evidence:** Name the currently functioning investments, bills, profile, and first Money Finder rule flows.
7. **Measured roadmap:** Introduce the next-$500 question as the product direction, not a finished feature.
8. **Engineering credibility:** Mention deterministic rules, citation metadata, review dates, explicit assumptions, and testing in one short passage.
9. **AI disclosure:** Briefly disclose substantial AI assistance while retaining ownership of product decisions, validation, and verification.
10. **CTA:** Ask one substantive question: “What context do you wish financial software understood before giving you an answer?”
11. **Link:** Include the public GitHub repository link.

Use no more than three relevant hashtags, and omit them if they make the ending feel promotional. Do not use engagement bait or claim that the post, product, or strategy is “viral.”

## Visual Companion

Replace the existing date-centric graphics with a three-image, 4:5 LinkedIn carousel. The visual language should match the product’s dark interface and use restrained typography, generous spacing, and large mobile-readable text.

### Image 1 — The human problem

Headline:

> Same numbers. Different lives. Different next move.

Supporting line:

> Financial guidance changes when software understands the person behind the accounts.

This image should lead with the idea rather than a feature list or dashboard screenshot.

### Image 2 — How MoneyTalks reasons

Show a simple flow:

> Financial facts + personal context → a monthly next move + why

Financial facts may include income, bills, debt, investments, and available cash. Personal context may include residency, citizenship, disability eligibility, benefits, and account eligibility. The recommendation area should use cautious language such as “compare,” “consider,” or “estimated effect.”

One small hypothetical contrast may demonstrate that the same available dollars can trigger a grant check, debt-paydown comparison, liquidity warning, or different cross-border tax assumptions. It must not present a definitive recommendation without supporting inputs.

### Image 3 — Working product and direction

Use real product evidence rather than a conceptual mockup wherever possible.

- **Working now:** investments, bills, profile context, and initial Money Finder rules.
- **Building toward:** card/debt inputs, safe-to-allocate cash, and explainable next-dollar scenarios.

Include a concise trust statement:

> Every recommendation should show what changed the answer.

The GitHub URL may appear discreetly. Avoid tiny code screenshots, dense date timelines, or claims that Cards and the allocation engine are already live.

## Product Recommendation Behind the Post

The smallest coherent high-ROI roadmap slice is a monthly allocation guardrail, ahead of a rewards-first card optimizer:

1. make income decision-grade with currency, net/gross treatment, effective dates, and freshness;
2. add a monthly spending reserve and emergency-cash floor;
3. implement minimum card-debt fields: currency, balance, balance date, APR, minimum payment, and due date;
4. convert inputs to a base currency and calculate only verified surplus;
5. compare a high-interest debt payment with a time-limited grant or contribution opportunity;
6. show assumptions, estimated effects, and an abstention state when data is inadequate.

Rewards optimization, automated transfers, generic AI chat, market predictions, credit-score monitoring, broad tax optimization, and comprehensive cross-border coverage are outside this post’s story and should not be added merely to make the product sound larger.

## Deliverables

- one final LinkedIn post in Markdown/plain text;
- three replacement 1080×1350 PNG carousel images;
- a short posting checklist covering alt text, link placement, timing-independent engagement practices, and claim verification;
- no modification or deletion of the prior visuals until the replacements pass review.

## Acceptance Criteria

The work is complete when:

- the personal motivation appears before the technical implementation details;
- the differentiator is explicitly financial facts plus personal context;
- the context is shown changing the analysis, not merely being collected;
- the next-$500 question is memorable and clearly labeled as direction;
- every current-versus-planned claim matches the repository;
- tax, benefit, debt, and cross-border wording is appropriately qualified;
- the visuals remain legible at mobile size and match the revised narrative;
- no private personal details or unsanitized design internals appear in the public-facing assets;
- the final post contains one substantive CTA and no engagement bait.

## Research Basis

- [LinkedIn Feed Engineering: next-generation feed](https://www.linkedin.com/blog/engineering/feed/engineering-the-next-generation-of-linkedins-feed)
- [LinkedIn: maximizing visibility in AI-powered discovery](https://www.linkedin.com/business/marketing/blog/ai-search/how-to-maximize-ai-visibility-for-your-linkedin-posts)
- [CRA: 2026 tax rates and income brackets](https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html)
- [CRA: RRSP overview](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/registered-retirement-savings-plan-rrsp.html)
- [CRA: FHSA deductions](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/tax-deductions-fhsa-contributions.html)
- [ESDC: RDSP grant and bond amounts](https://www.canada.ca/en/employment-social-development/programs/disability/savings/how-much.html)
- [FCAC: paying back debt](https://www.canada.ca/en/financial-consumer-agency/services/debt/paying-debt.html)
- [FCAC: paying off credit cards](https://www.canada.ca/en/financial-consumer-agency/services/credit-cards/pay-off-credit-card.html)
- [IRS: U.S. citizens and resident aliens abroad](https://www.irs.gov/individuals/international-taxpayers/us-citizens-and-resident-aliens-abroad)
