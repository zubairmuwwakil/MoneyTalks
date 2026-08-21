import Link from "next/link";

// The mobile bottom nav is fixed, so the footer needs its own clearance on top
// of the layout's pb-24 to avoid sitting underneath the tab bar.
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border/70 pb-20 pt-6 sm:pb-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="whitespace-nowrap">In Unity — personal finance command center</p>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-4">
          <Link
            href="/marketing"
            className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            Features
          </Link>
          <Link
            href="/signup"
            className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            Sign Up
          </Link>
          <Link
            href="/waitlist"
            className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            Beta Waitlist
          </Link>
          <Link
            href="/support"
            className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            Support
          </Link>
          <Link
            href="/privacy"
            className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
          >
            Terms of Service
          </Link>
        </nav>
      </div>
    </footer>
  );
}
