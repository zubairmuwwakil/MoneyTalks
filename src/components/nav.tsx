"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/investments", label: "Investments" },
  { href: "/bills", label: "Bills" },
  { href: "/cards", label: "Cards" },
  { href: "/money-finder", label: "Money Finder" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-background sm:sticky sm:top-0 sm:border-b sm:border-t-0">
      <ul className="mx-auto flex max-w-4xl items-stretch justify-between sm:justify-start sm:gap-2">
        {links.map(({ href, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1 sm:flex-none">
              <Link
                href={href}
                className={cn(
                  "block px-2 py-3 text-center text-xs sm:px-3 sm:text-sm",
                  active
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
