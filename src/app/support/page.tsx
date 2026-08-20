import type { Metadata } from "next";
import Link from "next/link";
import {
  Mail,
  HelpCircle,
  ShieldCheck,
  CreditCard,
  Trash2,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Support & Help Center — In Unity",
  description:
    "Get help with In Unity: contact support, view setup guides for Apple Wallet shortcuts, submit card requests, and manage your data.",
  alternates: { canonical: "https://inunity.ca/support" },
};

export const dynamic = "force-static";

const CONTACT_EMAIL = "zmuwwakil1@gmail.com";

const FAQS = [
  {
    question: "What is In Unity and how does it work?",
    answer:
      "In Unity is your personal finance command center and payment optimizer. On your iPhone, it tells you which card in your wallet earns the highest rewards on the purchase you are about to make, accounting for merchant categories, bonus caps, and point valuations. On the web hub, it unifies your multi-currency investments, recurring bill forecasts, and cross-border tax compliance checks.",
  },
  {
    question: "How do I set up Apple Wallet automation?",
    answer:
      "In Unity can automatically record transactions using an iOS Shortcut triggered when you tap with Apple Pay. You can generate and configure your installation token inside Settings under Apple Wallet. Transactions are captured securely without needing access to your bank login credentials.",
  },
  {
    question: "Are my bank login credentials or card numbers stored?",
    answer:
      "Never. Neither the iOS app nor the web server ever connects to your bank or card issuer. In Unity never asks for full card numbers, CVVs, PINs, or online banking passwords, and no screen in the product accepts them.",
  },
  {
    question: "What if my credit card is not listed in the catalogue?",
    answer:
      "If your card is not yet supported in our card catalogue, you can submit a card request directly through the app or by emailing support with the issuer and card name. We continuously expand catalogue rules and reward multipliers based on user demand.",
  },
  {
    question: "How do I export or delete my account and data?",
    answer:
      "You have complete control over your data. In the web hub, navigate to Settings → Privacy & Export to download a full JSON dump of your profile and transactions, or to permanently purge all server records. On your iPhone, you can erase local history anytime in app settings.",
  },
  {
    question: "How do I report a bug or calculation discrepancy?",
    answer:
      "If an alert, rule trigger, or card recommendation seems incorrect, email us at zmuwwakil1@gmail.com with details of the merchant, currency, and expected versus observed outcome. All rules are citation-backed and versioned.",
  },
];

export default function SupportPage() {
  return (
    <main className="py-10 sm:py-14">
      <div className="mx-auto max-w-3xl space-y-10">
        {/* Header */}
        <header className="space-y-4 border-b border-border pb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-bold tracking-tight transition-opacity hover:opacity-90"
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground/10 text-foreground overflow-hidden">
              <img src="/icon.svg" alt="In Unity" className="size-6" />
            </div>
            <span className="text-base font-semibold">In Unity</span>
          </Link>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Support &amp; Help Center</h1>
            <p className="text-[15px] leading-7 text-muted-foreground">
              Need assistance with In Unity? Contact our team, explore setup guides, or manage your account.
            </p>
          </div>
        </header>

        {/* Contact Support Card */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Contact Us</h2>
          <Card className="border-border/80 bg-muted/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Mail className="size-4.5 text-foreground" />
                <CardTitle className="text-base">Direct Developer &amp; App Support</CardTitle>
              </div>
              <CardDescription>
                Reach out for account inquiries, bug reports, card catalogue suggestions, or compliance questions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-background p-4 sm:flex sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Support Email
                  </p>
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("PickMe Support Request")}`}
                    className="text-base font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                  >
                    {CONTACT_EMAIL}
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Typical response time: within 24–48 hours
                  </p>
                </div>
                <div className="mt-3 sm:mt-0">
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("PickMe Support Request")}`}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-semibold text-background shadow-xs transition-colors hover:bg-foreground/90"
                  >
                    <MessageSquare className="size-3.5" />
                    <span>Send Email</span>
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Quick Navigation Cards */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Quick Actions &amp; Self-Service</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-semibold">Privacy Policy</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Understand how your data is handled on-device and on our servers.
                </p>
                <Link
                  href="/privacy"
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  <span>Read policy</span>
                  <ExternalLink className="size-3" />
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Trash2 className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-semibold">Data &amp; Privacy</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Export your full financial dataset or request immediate account deletion.
                </p>
                <Link
                  href="/settings/privacy"
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  <span>Manage data</span>
                  <ExternalLink className="size-3" />
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-semibold">Card Catalogue</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  View supported cards, multipliers, fee structures, and point valuation rules.
                </p>
                <Link
                  href="/cards"
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  <span>Explore cards</span>
                  <ExternalLink className="size-3" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* FAQs */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <HelpCircle className="size-5 text-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">Frequently Asked Questions</h2>
          </div>
          <div className="divide-y divide-border/60 rounded-xl border border-border bg-background">
            {FAQS.map((faq, index) => (
              <div key={index} className="p-5 space-y-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {faq.question}
                </h3>
                <p className="text-sm leading-6 text-muted-foreground">
                  {faq.answer}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* App Store & Developer Notes */}
        <footer className="border-t border-border pt-8 text-xs text-muted-foreground space-y-2">
          <p>
            In Unity is built and maintained by Zubair Muwwakil. Review our{" "}
            <Link
              href="/privacy"
              className="underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link
              href="/terms"
              className="underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              Terms of Service
            </Link>
            . For legal, data protection, or regulatory inquiries under PIPEDA or Law 25, contact{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <p>
            App Store Review Guideline 1.5 Support URL:{" "}
            <a
              href="https://inunity.ca/support"
              className="underline decoration-border underline-offset-4 hover:decoration-foreground"
            >
              https://inunity.ca/support
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
