# MoneyTalks LinkedIn Post and Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one recruiter-focused LinkedIn post, three 1080×1350 carousel images, and a posting checklist that explain how MoneyTalks combines financial facts with personal context to support an explainable next-dollar decision.

**Architecture:** Keep all publication artifacts isolated under `output/playwright/linkedin/` and leave application code unchanged. Author the carousel as one deterministic HTML/CSS document, render each fixed-size slide with a small Playwright script, and verify wording against the approved design and repository before delivery.

**Tech Stack:** Markdown, HTML/CSS, Node.js 20+, Playwright 1.62.1, macOS `sips`, local image inspection

## Global Constraints

- Primary audience: recruiters and hiring managers; secondary audience: developers and founders.
- The personal motivation must appear before technical implementation details.
- The differentiator must be “financial facts + personal context,” with context shown changing the analysis.
- “What should my next $500 do—and why?” is a roadmap question, not a completed-feature claim.
- Built claims are limited to investments, recurring bills and payments, profile context, and initial Money Finder rules with explanations/source metadata.
- Cards, debt payoff schedules, safe-to-allocate cash, comprehensive tax-and-benefit scenarios, and the full allocator must be labeled as next.
- Use “estimated effect,” “decision support,” and “scenario”; avoid “optimal,” “exact,” “guaranteed,” “tax-free,” “highest-ROI anywhere,” and “change tax brackets.”
- Do not call the current bill-only forecast a cash-flow forecast or the current asset total net worth.
- Do not expose private financial, citizenship, disability, military, retirement, or family details.
- Use one substantive CTA and no engagement bait.
- Use no hashtags in the recommended final copy; its natural-language keywords already establish relevance.
- Preserve the three prior date-centric PNGs unchanged until the replacement assets pass review.
- Do not modify application source, Prisma data, tests, or the user-modified `docs/superpowers/plans/2026-08-14-phase-3-bills.md`.

---

## File Map

- Create `output/playwright/linkedin/moneytalks-linkedin-post.md`: final paste-ready post and a separate alt-text section.
- Create `output/playwright/linkedin/posting-checklist.md`: short pre-publication and follow-up checklist.
- Create `output/playwright/linkedin/personalized-carousel.html`: the single source of truth for all three replacement slides.
- Create `output/playwright/linkedin/render-personalized-carousel.mjs`: deterministic Playwright renderer.
- Generate `output/playwright/linkedin/01-personal-context-final.png`: human problem and hook.
- Generate `output/playwright/linkedin/02-context-changes-answer-final.png`: facts-plus-context reasoning model.
- Generate `output/playwright/linkedin/03-working-now-next-final.png`: current evidence and measured roadmap.

The generated publication artifacts remain untracked unless the user separately asks to add them to the public repository.

---

### Task 1: Write the Final LinkedIn Copy and Posting Checklist

**Files:**
- Create: `output/playwright/linkedin/moneytalks-linkedin-post.md`
- Create: `output/playwright/linkedin/posting-checklist.md`
- Reference: `docs/superpowers/specs/2026-08-15-linkedin-post-design.md`

**Interfaces:**
- Consumes: approved narrative, claim boundary, CTA, and public repository URL from the design spec.
- Produces: exact final copy and alt text used by the delivery and verification tasks.

- [ ] **Step 1: Create the paste-ready post with this exact narrative**

Use `apply_patch` to create `output/playwright/linkedin/moneytalks-linkedin-post.md`. Begin with a `## Post` heading and use the following body, preserving short paragraphs for mobile scanning:

```text
Two people can have the same income, bills, card balance, investments—and $500 left this month.

The right next move can still be different.

I started building MoneyTalks because I wanted one place that understood not only my finances, but the circumstances that make those numbers mean something.

Most personal-finance tools begin with accounts and transactions. MoneyTalks combines the financial facts—income, upcoming bills, debt, investments, and contribution room—with personal context such as residency, citizenship, disability eligibility, benefit programs, and household circumstances.

Why does that context matter?

The same $500 might need to stay available for upcoming bills, reduce expensive debt, capture an eligible grant, or go into an appropriate registered account. Income can change the estimated value of a contribution and the benefits affected by it. Residency or citizenship can change the assumptions behind an account’s tax treatment.

The useful answer is not simply “do X.”

It is: “Consider X because these inputs changed the trade-off. Here are the assumptions and estimated effects.”

The working product already tracks investments, recurring bills and payments, profile context, and runs its first deterministic Money Finder rules with explanations, citations, and freshness checks.

I’m building toward one question:

Given my income, bills, debt, account room, and personal circumstances, what should my next $500 do—and why?

Cards, debt payoff schedules, safe-to-allocate cash, and that full allocation view are next—not features I’m pretending are already finished.

AI accelerated the build substantially. I remain responsible for the product decisions, rule design, testing, and verification.

Code: https://github.com/zubairmuwwakil/MoneyTalks

What context do you wish financial software understood before giving you an answer?
```

After the post, add a `## Carousel alt text` section with these exact entries:

```text
1. Dark MoneyTalks graphic reading “Same numbers. Different lives. Different next move.” It explains that financial guidance changes when software understands the person behind the accounts.
2. Diagram showing financial facts such as income, bills, debt, investments, and available cash combined with personal context such as residency, citizenship, disability eligibility, benefits, and account eligibility. The result is an explainable monthly next move with assumptions and estimated effects.
3. MoneyTalks progress graphic separating working features—investments, bills and payments, profile context, and initial Money Finder rules—from planned card and debt inputs, safe-to-allocate cash, and side-by-side next-dollar scenarios.
```

- [ ] **Step 2: Check length, unsupported claims, and forbidden wording**

Run:

```bash
awk '/^## Post$/{on=1;next}/^## Carousel alt text$/{on=0}on' output/playwright/linkedin/moneytalks-linkedin-post.md | wc -w
rg -ni "optimal|exact|guaranteed|highest-roi|change tax brackets|cash-flow forecast|net worth|already recommends|tax-free" output/playwright/linkedin/moneytalks-linkedin-post.md
```

Expected:

- Post body is between 220 and 300 words.
- `rg` returns no matches.

- [ ] **Step 3: Create the posting checklist**

Use `apply_patch` to create `output/playwright/linkedin/posting-checklist.md` with these sections and checks:

```markdown
# MoneyTalks LinkedIn Posting Checklist

## Before publishing

- [ ] Re-read the public GitHub repository and remove or sanitize anything that should not be discoverable from the post.
- [ ] Re-run the claim audit in the implementation plan and confirm Cards, payoff schedules, safe-to-allocate cash, and the allocator are still labeled as next.
- [ ] Upload the three images in numeric order and paste the supplied alt text for each image.
- [ ] Paste the post without adding engagement bait or unsupported superlatives.
- [ ] Confirm the GitHub URL opens while signed out.
- [ ] Publish from the personal profile because the primary goal is recruiter and hiring-manager visibility.

## After publishing

- [ ] Respond substantively to genuine questions and technical feedback.
- [ ] Correct any misunderstood built-versus-planned claim in the post rather than defending ambiguous wording.
- [ ] Record useful product questions, but do not promise features in comments before evaluating them.
```

- [ ] **Step 4: Review the two Markdown files as rendered text**

Run:

```bash
sed -n '1,260p' output/playwright/linkedin/moneytalks-linkedin-post.md
sed -n '1,220p' output/playwright/linkedin/posting-checklist.md
```

Expected: the post reads naturally without the alt text being part of the paste-ready body, and the checklist contains no private facts.

---

### Task 2: Author the Personalized Three-Slide Carousel

**Files:**
- Create: `output/playwright/linkedin/personalized-carousel.html`
- Reference: `output/playwright/linkedin/01-biweekly-timeline-final.png`
- Reference: `output/playwright/linkedin/02-forecast-proof-final.png`
- Reference: `output/playwright/linkedin/03-engineering-proof-final.png`

**Interfaces:**
- Consumes: the approved slide copy and existing visual language.
- Produces: three `.slide` elements with IDs `slide-1`, `slide-2`, and `slide-3`, each exactly 1080×1350 CSS pixels.

- [ ] **Step 1: Create a deterministic HTML/CSS source**

Use `apply_patch` to create `output/playwright/linkedin/personalized-carousel.html`. Use no remote fonts, scripts, images, or network resources. Define these tokens:

```css
:root {
  --canvas: #0d1116;
  --surface: #151a20;
  --surface-2: #1a2027;
  --text: #f4f1eb;
  --muted: #aeb6c1;
  --line: #343b44;
  --orange: #ffad4d;
  --green: #a7ed59;
}

* { box-sizing: border-box; }
html, body { margin: 0; background: #05070a; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
.slide {
  position: relative;
  width: 1080px;
  height: 1350px;
  overflow: hidden;
  padding: 72px;
  color: var(--text);
  background: linear-gradient(180deg, #11161b 0%, var(--canvas) 100%);
}
```

Each slide must also include:

- top eyebrow `MONEYTALKS · BUILDING IN PUBLIC`;
- a circled slide number in the top-right;
- a thin bottom divider;
- bottom-left takeaway text;
- bottom-right `Work in progress · August 2026` on slides 1–2 and `github.com/zubairmuwwakil/MoneyTalks` on slide 3;
- minimum body text size of 28px and minimum metadata size of 18px.

- [ ] **Step 2: Add slide 1 with the personal hook**

Use this exact visible copy:

```text
Same numbers.
Different lives.
Different next move.

Financial guidance changes when software understands the person behind the accounts.

FINANCIAL FACTS  +  PERSONAL CONTEXT

Understand the person, not only the portfolio.
```

Style `Different lives.` in orange. Keep the large headline above the fold and avoid feature cards on this slide.

- [ ] **Step 3: Add slide 2 with the reasoning model**

Use this exact visible copy:

```text
Context changes the answer.

FINANCIAL FACTS
Income
Upcoming bills
Debt + interest
Investments
Available cash

PERSONAL CONTEXT
Residency + citizenship
Disability eligibility
Benefits
Household circumstances
Account eligibility

WHAT SHOULD MY NEXT $500 DO?
Protect upcoming bills
Compare debt payoff
Check an eligible grant or contribution

Show why · State assumptions · Estimate the effect
```

Lay out the two inputs as equal columns flowing into one larger result panel. Use “compare” and “check” rather than imperative investment instructions. Add a small `ILLUSTRATIVE DECISION SUPPORT` label to the result panel.

- [ ] **Step 4: Add slide 3 with evidence and roadmap restraint**

Use this exact visible copy:

```text
From tracking money to explaining the next move.

WORKING NOW
Investments + balances
Recurring bills + payments
Profile-aware Money Finder rules
Explanations + source freshness

BUILDING TOWARD
Card + debt inputs
Safe-to-allocate cash
Side-by-side next-dollar scenarios

143
UNIT TESTS PASSING

18
TEST FILES PASSING

CLEAN
ESLINT RESULT

Every recommendation should show what changed the answer.
```

Render the current and next columns with visibly different labels, and include `Verified locally · August 15, 2026` beside the engineering evidence. Treat the numbers as provisional until Task 4 reruns the checks; update the HTML if live results differ.

- [ ] **Step 5: Perform a static content check**

Run:

```bash
rg -n 'Same numbers|Different lives|Context changes the answer|FINANCIAL FACTS|PERSONAL CONTEXT|WHAT SHOULD MY NEXT \$500 DO|WORKING NOW|BUILDING TOWARD|Every recommendation should show' output/playwright/linkedin/personalized-carousel.html
rg -ni "optimal|exact|guaranteed|highest-roi|change tax brackets|tax-free|net worth|cash-flow forecast" output/playwright/linkedin/personalized-carousel.html
```

Expected: every required phrase is found by the first command; the second command returns no matches.

---

### Task 3: Implement the Deterministic Renderer and Generate the PNGs

**Files:**
- Create: `output/playwright/linkedin/render-personalized-carousel.mjs`
- Generate: `output/playwright/linkedin/01-personal-context-final.png`
- Generate: `output/playwright/linkedin/02-context-changes-answer-final.png`
- Generate: `output/playwright/linkedin/03-working-now-next-final.png`

**Interfaces:**
- Consumes: `personalized-carousel.html` with `#slide-1`, `#slide-2`, and `#slide-3`.
- Produces: three 1080×1350 PNG files with stable names.

- [ ] **Step 1: Write the renderer**

Use `apply_patch` to create this script:

```javascript
import { chromium } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outputDir = path.join(root, "output/playwright/linkedin");
const source = path.join(outputDir, "personalized-carousel.html");
const outputs = [
  "01-personal-context-final.png",
  "02-context-changes-answer-final.png",
  "03-working-now-next-final.png",
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1080, height: 1350 },
    deviceScaleFactor: 1,
  });
  await page.goto(pathToFileURL(source).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  for (let index = 0; index < outputs.length; index += 1) {
    const slide = page.locator(`#slide-${index + 1}`);
    const box = await slide.boundingBox();
    if (!box || box.width !== 1080 || box.height !== 1350) {
      throw new Error(`slide-${index + 1} is not 1080x1350`);
    }
    await slide.screenshot({ path: path.join(outputDir, outputs[index]) });
  }
} finally {
  await browser.close();
}
```

- [ ] **Step 2: Render the carousel**

First confirm the prior assets still match their approved hashes:

```bash
shasum output/playwright/linkedin/01-biweekly-timeline-final.png output/playwright/linkedin/02-forecast-proof-final.png output/playwright/linkedin/03-engineering-proof-final.png
```

Expected:

```text
3b42e31764bc4bc5cf957eda3f2daba635ccc9cb  output/playwright/linkedin/01-biweekly-timeline-final.png
d79c8b63264252728ad486cd182bc35b4a85fab9  output/playwright/linkedin/02-forecast-proof-final.png
32c3858eac76538ae621e4dd501dca091a18cef1  output/playwright/linkedin/03-engineering-proof-final.png
```

Then run:

```bash
node output/playwright/linkedin/render-personalized-carousel.mjs
```

Expected: exit code 0 and all three new PNG files exist. The prior three PNGs still exist unchanged.

- [ ] **Step 3: Verify file dimensions and basic integrity**

Run:

```bash
sips -g pixelWidth -g pixelHeight output/playwright/linkedin/01-personal-context-final.png output/playwright/linkedin/02-context-changes-answer-final.png output/playwright/linkedin/03-working-now-next-final.png
file output/playwright/linkedin/01-personal-context-final.png output/playwright/linkedin/02-context-changes-answer-final.png output/playwright/linkedin/03-working-now-next-final.png
```

Expected: every image reports 1080×1350 and valid PNG data.

- [ ] **Step 4: Inspect all three images visually**

Open each PNG with the local image viewer. Verify:

- no clipping, overlap, or text below the canvas;
- slide hierarchy remains clear when viewed at approximately 25% size;
- the orange accent supports meaning rather than decorating every element;
- slide 2 reads left-to-right from facts and context to the result;
- slide 3 makes “working now” and “building toward” impossible to confuse;
- all metadata and the GitHub URL remain legible.

If a visual defect exists, patch only `personalized-carousel.html`, rerun the renderer, and repeat the dimension and visual checks.

---

### Task 4: Verify the Repository Claims and Prepare Delivery

**Files:**
- Modify if necessary: `output/playwright/linkedin/moneytalks-linkedin-post.md`
- Modify if necessary: `output/playwright/linkedin/personalized-carousel.html`
- Regenerate if necessary: the three new PNGs
- Preserve: the three prior date-centric PNGs

**Interfaces:**
- Consumes: final copy, carousel source, PNGs, and current repository state.
- Produces: a verified delivery set and a concise user handoff.

- [ ] **Step 1: Re-run automated project verification**

Run:

```bash
npm test
npm run lint
```

Expected as of the approved design: 143 tests pass across 18 files and ESLint exits cleanly. If the live counts differ but tests still pass, update slide 3 to the live counts and rerender. If a test or lint check fails, do not claim it passes; report the failure without changing application code.

- [ ] **Step 2: Audit current-versus-planned claims against the repository**

Run:

```bash
rg -n "Coming in Phase 4" src/app/cards/page.tsx
rg -n "model CreditCard|model CardState" prisma/schema.prisma
rg -n "incomeSources|citizenships|dtcEligible|benefitPrograms|tfsaRoomMinor|rrspRoomMinor|fhsaRoomMinor" prisma/schema.prisma
rg -n "citation|lastReviewed" src/engine/rules/types.ts src/engine/rules/*.ts
rg -n "errors|RULES_STALE" src/engine/rules/registry.ts src/app/money-finder/page.tsx
```

Expected:

- Cards remains a placeholder and no card model exists, supporting the “next” label.
- Profile context, citation/review metadata, stale-rule warnings, and failure isolation exist, supporting the “working now” label.

- [ ] **Step 3: Run the final copy and visual wording audit**

Run:

```bash
rg -ni "optimal|exact|guaranteed|highest-roi|change tax brackets|tax-free|cash-flow forecast|net worth|already recommends" output/playwright/linkedin/moneytalks-linkedin-post.md output/playwright/linkedin/personalized-carousel.html
awk '/^## Post$/{on=1;next}/^## Carousel alt text$/{on=0}on' output/playwright/linkedin/moneytalks-linkedin-post.md | wc -w
sips -g pixelWidth -g pixelHeight output/playwright/linkedin/0[1-3]-*-final.png
shasum output/playwright/linkedin/01-biweekly-timeline-final.png output/playwright/linkedin/02-forecast-proof-final.png output/playwright/linkedin/03-engineering-proof-final.png
git status --short
```

Expected:

- no forbidden wording;
- post body remains between 220 and 300 words;
- all six old and new PNGs remain 1080×1350;
- prior carousel hashes remain `3b42e31764bc4bc5cf957eda3f2daba635ccc9cb`, `d79c8b63264252728ad486cd182bc35b4a85fab9`, and `32c3858eac76538ae621e4dd501dca091a18cef1` in numeric order;
- only the user’s pre-existing plan change and expected untracked `output/` artifacts appear outside this implementation plan.

- [ ] **Step 4: Deliver the publication package**

The handoff must link directly to:

- the final post Markdown file;
- each of the three new PNGs;
- the posting checklist.

State the live test/lint result, identify the old carousel as preserved, and note that the new assets are untracked publication artifacts rather than committed application changes.
