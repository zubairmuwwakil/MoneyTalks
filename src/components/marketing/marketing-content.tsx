import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Globe2,
  Lock,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Undo2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function MarketingContent() {
  return (
    <div className="flex flex-col space-y-20 py-6 sm:py-10">
      {/* Hero Section */}
      <section className="relative flex flex-col items-center text-center space-y-6 pt-4 pb-4 sm:pt-6 sm:pb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/60 px-3.5 py-1 text-xs font-medium text-foreground">
          <Sparkles className="size-3.5 text-primary" />
          <span>Inunity Early Access &amp; TestFlight Beta</span>
        </div>

        <h1 className="max-w-4xl text-3xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-foreground">
          The Personal Finance Command Center &amp;{" "}
          <span className="bg-gradient-to-r from-foreground via-foreground/90 to-foreground/60 bg-clip-text text-transparent">
            Ambient Card Copilot
          </span>
        </h1>

        <p className="max-w-2xl text-sm sm:text-lg text-muted-foreground leading-relaxed">
          Max out rewards on every swipe without thinking. Automate receipt ingestion and return windows.
          Track multi-currency net worth and spot cross-border tax compliance triggers — 100% private by construction.
        </p>

        {/* Hero CTAs */}
        <div className="flex flex-col w-full sm:w-auto sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/waitlist"
            className="inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-foreground px-6 text-sm font-semibold text-background shadow-xs transition-all hover:bg-foreground/90 hover:shadow-md"
          >
            <span>Request Early Beta Access</span>
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-border bg-background px-6 text-sm font-semibold text-foreground shadow-2xs transition-colors hover:bg-muted"
          >
            <span>Sign In to Hub</span>
          </Link>
        </div>

        {/* Quick Trust Badges */}
        <div className="flex flex-wrap items-center justify-center gap-y-2 gap-x-6 pt-4 text-xs font-medium text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
            <span>Zero bank credentials required</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="size-4 text-amber-600 dark:text-amber-400" />
            <span>On-device offline card picks</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe2 className="size-4 text-sky-600 dark:text-sky-400" />
            <span>CAD, USD &amp; cross-border rules</span>
          </div>
        </div>

        {/* Visual UI Preview Hero Banner */}
        <div className="w-full max-w-5xl pt-6">
          <div className="overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-card to-muted/30 p-4 sm:p-6 shadow-xl text-left">
            <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-foreground/10 text-foreground overflow-hidden">
                  <img src="/icon.svg" alt="Inunity" className="size-5" />
                </div>
                <span className="font-semibold text-sm">Inunity Command Surface</span>
              </div>
              <Badge variant="outline" className="text-[11px] font-mono">
                LIVE DEMO PREVIEW
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {/* Card Recommendation Widget */}
              <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-background p-4 shadow-2xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Ambient Card Copilot
                    </span>
                    <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      Optimal Choice
                    </Badge>
                  </div>
                  <p className="text-sm font-semibold text-foreground">Loblaw Companies / Groceries</p>
                  <div className="rounded-lg bg-muted/50 p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">Cobalt / PC Elite</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">5.0x / 5% back</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Advantage over baseline: +$24.50/mo on current grocery volume
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-2">
                  <span>Cap status: 42% utilized</span>
                  <span className="font-medium text-foreground">Verified issuer rules</span>
                </div>
              </div>

              {/* Net Worth & Cashflow Widget */}
              <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-background p-4 shadow-2xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Multi-Currency Net Worth
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      BoC FX Live
                    </Badge>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tracking-tight tabular-nums">$148,250</span>
                    <span className="text-xs font-medium text-muted-foreground">CAD</span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Upcoming Bills (14d)</span>
                      <span className="font-semibold text-foreground">$1,240.00</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Cash Cushion</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">Safe ($5,000 target)</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-2">
                  <span>Forecast status: No pile-ups</span>
                  <span className="font-medium text-foreground">12-mo timeline</span>
                </div>
              </div>

              {/* Compliance & Catch-Net Widget */}
              <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-background p-4 shadow-2xs">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Money Finder &amp; Returns
                    </span>
                    <Badge variant="secondary" className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      Actionable
                    </Badge>
                  </div>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 space-y-0.5">
                    <p className="text-xs font-semibold text-foreground">FHSA Contribution Room: $8,000</p>
                    <p className="text-[11px] text-muted-foreground">Tax savings potential: up to $3,480 CAD</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-2 space-y-0.5">
                    <div className="flex justify-between text-xs font-medium">
                      <span>Amazon return window</span>
                      <span className="text-amber-600 dark:text-amber-400">3 days left</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Item: Audio Interface ($189.00)</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/40 pt-2">
                  <span>24 active compliance engines</span>
                  <span className="font-medium text-foreground">FBAR / PFIC / DTC</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Pillars Grid */}
      <section className="space-y-10">
        <div className="text-center space-y-3">
          <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wider">
            Engineered For Control
          </Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
            Everything your money touches, unified in one command hub
          </h2>
          <p className="mx-auto max-w-2xl text-xs sm:text-base text-muted-foreground">
            Built from scratch for individuals with multi-currency accounts, multiple credit card reward programs, and cross-border tax considerations.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Feature 1 */}
          <Card className="flex flex-col justify-between border-border/80 bg-card p-6 shadow-2xs hover:border-foreground/30 transition-all">
            <div className="space-y-3">
              <div className="inline-flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                <CreditCard className="size-5" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">Smart Card Multipliers &amp; ROI</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Know exactly which card earns the highest return before tapping. Tracks category multipliers, spend caps, monthly resets, and fee break-even points with honest keep/cancel verdicts.
              </p>
            </div>
            <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>10+ verified Canadian &amp; US cards</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Annual fee keep/downgrade/cancel math</span>
              </li>
            </ul>
          </Card>

          {/* Feature 2 */}
          <Card className="flex flex-col justify-between border-border/80 bg-card p-6 shadow-2xs hover:border-foreground/30 transition-all">
            <div className="space-y-3">
              <div className="inline-flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                <Undo2 className="size-5" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">Receipts &amp; Return Catch-Net</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Catch expiring return windows before money is lost. Ingest purchase receipts automatically, monitor refund arrival timelines, and review subscriptions before renewal.
              </p>
            </div>
            <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Automated return deadline alerts</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Never miss an unpaid merchant refund</span>
              </li>
            </ul>
          </Card>

          {/* Feature 3 */}
          <Card className="flex flex-col justify-between border-border/80 bg-card p-6 shadow-2xs hover:border-foreground/30 transition-all">
            <div className="space-y-3">
              <div className="inline-flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                <TrendingUp className="size-5" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">Multi-Currency Net Worth</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Integer-precise minor units arithmetic across CAD, USD, and JMD. Refresh spot FX rates directly from the Bank of Canada and crypto valuations from CoinGecko.
              </p>
            </div>
            <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Historical net worth balance sparklines</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Duplicate-resistant CSV import hashing</span>
              </li>
            </ul>
          </Card>

          {/* Feature 4 */}
          <Card className="flex flex-col justify-between border-border/80 bg-card p-6 shadow-2xs hover:border-foreground/30 transition-all">
            <div className="space-y-3">
              <div className="inline-flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                <Receipt className="size-5" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">12-Month Cashflow &amp; Bills</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Project upcoming expenses, detect bill pile-ups, and safeguard your minimum cash cushion. Mark bills as paid with actuals to track budget drift.
              </p>
            </div>
            <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Effective-dated recurring timelines</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Cash cushion dip warnings</span>
              </li>
            </ul>
          </Card>

          {/* Feature 5 */}
          <Card className="flex flex-col justify-between border-border/80 bg-card p-6 shadow-2xs hover:border-foreground/30 transition-all">
            <div className="space-y-3">
              <div className="inline-flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                <Sparkles className="size-5" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">Money Finder Rules Engine</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                24 built-in compliance and grant rules surfacing cross-border filing triggers (FBAR, 8938, PFIC, T1135) and benefit opportunities (RDSP grant/bond, FHSA, DTC, CWB).
              </p>
            </div>
            <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Printable filing-season tax checklist</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Exact statutory legal citations included</span>
              </li>
            </ul>
          </Card>

          {/* Feature 6 */}
          <Card className="flex flex-col justify-between border-border/80 bg-card p-6 shadow-2xs hover:border-foreground/30 transition-all">
            <div className="space-y-3">
              <div className="inline-flex size-10 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                <Zap className="size-5" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">Ambient iOS Copilot</h3>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                Get geofenced, silent suggestions as you arrive at a merchant. Powered by native iOS shortcuts and on-device logic with zero cloud lag at checkout.
              </p>
            </div>
            <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Runs 100% offline at the register</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5 text-emerald-600" />
                <span>Apple Pay &amp; Shortcuts transaction hooks</span>
              </li>
            </ul>
          </Card>
        </div>
      </section>

      {/* Privacy By Construction Section */}
      <section className="rounded-2xl border border-border/80 bg-gradient-to-b from-card to-muted/20 p-6 sm:p-12 shadow-xs">
        <div className="mx-auto max-w-3xl space-y-6 sm:space-y-8 text-center">
          <div className="inline-flex size-12 items-center justify-center rounded-xl bg-foreground/5 text-foreground">
            <Lock className="size-6" />
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
              Privacy by Construction
            </h2>
            <p className="text-xs sm:text-base text-muted-foreground leading-relaxed">
              We believe your financial life should never be scraped, sold, or aggregated by third-party data brokers.
            </p>
          </div>

          <div className="grid gap-4 text-left sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-background/80 p-4 space-y-1.5">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" />
                No Bank Logins Ever
              </h4>
              <p className="text-xs text-muted-foreground">
                We never ask for your online banking username or password. No Plaid, no Flinks, no credential scraping.
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/80 p-4 space-y-1.5">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Pure Code Local Logic
              </h4>
              <p className="text-xs text-muted-foreground">
                Rule engines and card multipliers run deterministically in pure code with zero outbound telemetry.
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/80 p-4 space-y-1.5">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Encrypted Credentials
              </h4>
              <p className="text-xs text-muted-foreground">
                OAuth connections use AES-GCM encryption at rest with versioned keys and fail-closed security.
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/80 p-4 space-y-1.5">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Complete Data Ownership
              </h4>
              <p className="text-xs text-muted-foreground">
                Export all transactions, accounts, and records as JSON with one click. Cascade-delete your entire account anytime.
              </p>
            </div>
          </div>

          <div className="pt-2">
            <Link
              href="/privacy"
              className="text-xs font-semibold text-foreground underline underline-offset-4 hover:opacity-80"
            >
              Read our full transparent Privacy Policy →
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="space-y-10">
        <div className="text-center space-y-3">
          <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wider">
            Simple 3-Step Setup
          </Badge>
          <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">How Inunity Works</h2>
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          <div className="relative rounded-xl border border-border/80 bg-card p-6 space-y-3">
            <span className="text-3xl font-extrabold text-muted-foreground/30">01</span>
            <h3 className="text-base font-semibold">Select Your Active Cards</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Pick your wallet cards from our verified catalogue of Canadian and cross-border programs with prefilled reward benchmarks.
            </p>
          </div>

          <div className="relative rounded-xl border border-border/80 bg-card p-6 space-y-3">
            <span className="text-3xl font-extrabold text-muted-foreground/30">02</span>
            <h3 className="text-base font-semibold">Ambient Pick at Checkout</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              When standing at a register or shopping online, Inunity calculates the optimal card based on real category multipliers and caps.
            </p>
          </div>

          <div className="relative rounded-xl border border-border/80 bg-card p-6 space-y-3">
            <span className="text-3xl font-extrabold text-muted-foreground/30">03</span>
            <h3 className="text-base font-semibold">Command Center Insight</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Log into your hub to review cashflow forecasts, return deadlines, fee ROI verdicts, and compliance triggers in one dashboard.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="space-y-6 max-w-3xl mx-auto w-full">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Frequently Asked Questions</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Everything you need to know about the Inunity hub and copilot.</p>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-2">
            <h4 className="text-sm font-semibold">Which credit cards are currently supported?</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              We launch with verified catalogues covering major Canadian and cross-border cards including Amex Platinum, Cobalt, Marriott Bonvoy, MBNA Rewards World Elite, Scotiabank Momentum Infinite, Tangerine Money-Back, Rogers Red World Elite, Canadian Tire Triangle World Elite, Wealthsimple Visa, and Crypto.com. You can also request additions directly from your dashboard.
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-2">
            <h4 className="text-sm font-semibold">Does Inunity need my online banking credentials?</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Never. We do not use credential-scraping aggregators (like Plaid or Flinks). You maintain complete control of your data via manual entry, statement CSV import, and optional private email receipt ingestion.
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-2">
            <h4 className="text-sm font-semibold">How does the ambient recommendation work offline?</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The card recommendation rules are compiled directly into the client engine. They calculate instant reward values locally without requiring an internet connection or cloud ping at checkout.
            </p>
          </div>

          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-2">
            <h4 className="text-sm font-semibold">What is the Money Finder module?</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Money Finder evaluates your account balances, residency profile, and assets against 24 statutory cross-border compliance rules (FBAR, Form 8938, PFIC, T1135) and Canadian benefit programs (RDSP grants, FHSA contribution room, Disability Tax Credit).
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA Card */}
      <section className="rounded-2xl border border-border bg-foreground text-background p-8 sm:p-12 text-center space-y-6 shadow-xl">
        <div className="space-y-2 max-w-xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Take command of your financial edge today
          </h2>
          <p className="text-xs sm:text-sm text-background/80">
            Join the invite-only beta to get TestFlight access for the ambient iOS card copilot and full access to the Inunity web command center.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/waitlist"
            className="inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-background px-6 text-sm font-semibold text-foreground shadow-sm transition-all hover:bg-background/90"
          >
            <span>Join Beta Waitlist</span>
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-background/20 bg-transparent px-6 text-sm font-semibold text-background transition-colors hover:bg-background/10"
          >
            <span>Sign In</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
