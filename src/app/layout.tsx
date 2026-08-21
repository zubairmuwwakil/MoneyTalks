import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/nav";
import { CommandPalette } from "@/components/command-palette";
import { SiteFooter } from "@/components/site-footer";
import { SwRegister } from "@/components/sw-register";
import { SonnerProvider } from "@/components/sonner-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "In Unity — Personal Finance Command Center",
    template: "%s | In Unity",
  },
  description:
    "Personal finance command center for multi-currency tracking, ambient card rewards copilot, cashflow forecasting, and cross-border tax compliance.",
  applicationName: "In Unity",
  authors: [{ name: "In Unity Team" }],
  keywords: [
    "Personal Finance",
    "Credit Card Rewards",
    "Amex Cobalt",
    "Multi-Currency",
    "Net Worth Tracker",
    "Return Catch-Net",
    "Cross-Border Tax",
    "FBAR",
    "PFIC",
    "FHSA",
  ],
  openGraph: {
    title: "In Unity — Personal Finance Command Center",
    description:
      "Max out rewards on every swipe, project 12-month bill cashflow, track multi-currency net worth, and catch cross-border compliance triggers.",
    url: "https://inunity.ca",
    siteName: "In Unity",
    locale: "en_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "In Unity — Personal Finance Command Center",
    description:
      "Max out rewards on every swipe, project 12-month bill cashflow, and catch cross-border compliance triggers.",
  },
  icons: {
    icon: [
      { url: "/favicon-dark.png", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon-light.png", media: "(prefers-color-scheme: light)" },
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <html lang="en" className="h-full" suppressHydrationWarning>
        <head>
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem("inunity-theme");if(t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}else{document.documentElement.classList.remove("dark")}}catch(e){}})()`,
            }}
          />
        </head>
        <body className="min-h-full bg-background text-foreground antialiased selection:bg-foreground selection:text-background">
          <SwRegister />
          <CommandPalette />
          <Nav />
          <div className="mx-auto max-w-5xl px-4 sm:px-6 sm:pt-2">
            {children}
          </div>
          <SiteFooter />
          <SonnerProvider />
        </body>
      </html>
    </ClerkProvider>
  );
}
