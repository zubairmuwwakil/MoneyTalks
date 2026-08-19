import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site-footer";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inunity — Personal Finance Command Center",
  description: "Personal finance command center for multi-currency tracking, investments, cashflow forecasting, and tax compliance.",
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
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <html lang="en" className="h-full">
        <body className="min-h-full bg-background text-foreground antialiased selection:bg-foreground selection:text-background">
          <SwRegister />
          <Nav />
          <div className="mx-auto max-w-5xl px-4 sm:px-6 sm:pt-2">
            {children}
          </div>
          <SiteFooter />
        </body>
      </html>
    </ClerkProvider>
  );
}
