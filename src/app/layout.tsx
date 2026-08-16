import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Nav } from "@/components/nav";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoneyTalks — Personal Finance Command Center",
  description: "Personal finance command center for multi-currency tracking, investments, cashflow forecasting, and tax compliance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="h-full">
        <body className="min-h-full bg-background text-foreground antialiased selection:bg-foreground selection:text-background">
          <SwRegister />
          <Nav />
          <div className="mx-auto max-w-5xl px-4 pb-24 sm:px-6 sm:pb-12 sm:pt-2">
            {children}
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}
