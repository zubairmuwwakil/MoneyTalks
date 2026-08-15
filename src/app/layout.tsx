import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoneyTalks",
  description: "Personal finance command center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Nav />
        <div className="mx-auto max-w-4xl px-4 pb-20 sm:pb-4">
          {children}
        </div>
      </body>
    </html>
  );
}
