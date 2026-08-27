import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  SECTIONS,
  EFFECTIVE_DATE,
  CONTACT_EMAIL,
  PUBLISHER,
  TERMS_URL,
  type Block,
} from "./content";

// Public by design: App Store Connect requires legal URLs that are
// reachable without signing in. The route is allowlisted in src/proxy.ts.
export const metadata: Metadata = {
  title: "Terms of Service — In Unity",
  description:
    "Terms and conditions governing your use of the In Unity web platform and the PickMe iOS app.",
  alternates: { canonical: TERMS_URL },
};

// Static: nothing here depends on a request, a session, or the database.
export const dynamic = "force-static";

// Minimal inline formatting so the terms text can stay plain strings in
// content.ts: **bold** and [label](href).
function formatInline(text: string, keyPrefix: string) {
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    if (match[1] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${match.index}`} className="font-semibold text-foreground">
          {match[1]}
        </strong>,
      );
    } else {
      const isInternal = match[3]?.startsWith("/");
      nodes.push(
        <a
          key={`${keyPrefix}-a-${match.index}`}
          href={match[3]}
          className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          {...(!isInternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {match[2]}
        </a>,
      );
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function BlockView({ block, id }: { block: Block; id: string }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="text-[15px] leading-7 text-muted-foreground">
          {formatInline(block.text, id)}
        </p>
      );

    case "sub":
      return (
        <h3 className="pt-2 text-sm font-semibold tracking-tight text-foreground">
          {block.text}
        </h3>
      );

    case "bullets":
      return (
        <ul className="space-y-2 pl-1">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-[15px] leading-7 text-muted-foreground">
              <span aria-hidden className="mt-3 size-1 shrink-0 rounded-full bg-border" />
              <span>{formatInline(item, `${id}-${i}`)}</span>
            </li>
          ))}
        </ul>
      );

    case "note":
      return (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-[15px] leading-7 text-foreground">
          {formatInline(block.text, id)}
        </div>
      );

    case "table":
      return (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                {block.head.map((h, i) => (
                  <th key={i} className="py-2 pr-4 align-bottom font-semibold text-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-border/60 last:border-0">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={
                        c === 0
                          ? "py-3 pr-4 align-top font-medium text-foreground"
                          : "py-3 pr-4 align-top leading-6 text-muted-foreground"
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export default function TermsOfServicePage() {
  return (
    <main className="py-10 sm:py-14">
      <div className="mx-auto max-w-2xl">
        <header className="space-y-5 border-b border-border pb-8">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-2 font-bold tracking-tight transition-opacity hover:opacity-90"
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground/10 text-foreground overflow-hidden shrink-0">
              <Image src="/icon.svg" alt="In Unity" width={24} height={24} className="size-6" />
            </div>
            <span className="text-base font-semibold whitespace-nowrap">In Unity</span>
          </Link>

          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Terms of Service</h1>
            <p className="text-[15px] leading-7 text-muted-foreground">
              For the In Unity web command center and the PickMe app for iPhone.
            </p>
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-medium text-foreground">Effective</dt>
            <dd className="text-muted-foreground">{EFFECTIVE_DATE}</dd>
            <dt className="font-medium text-foreground">Published by</dt>
            <dd className="text-muted-foreground">{PUBLISHER}</dd>
            <dt className="font-medium text-foreground">Contact</dt>
            <dd>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
              >
                {CONTACT_EMAIL}
              </a>
            </dd>
          </dl>
        </header>

        <nav aria-label="Contents" className="border-b border-border py-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contents
          </h2>
          <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {SECTIONS.map((section, i) => (
              <li key={section.id} className="text-sm">
                <a
                  href={`#${section.id}`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="tabular-nums">{i + 1}.</span> {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="divide-y divide-border">
          {SECTIONS.map((section, i) => (
            <section key={section.id} id={section.id} className="scroll-mt-20 py-8">
              <h2 className="mb-4 text-xl font-bold tracking-tight">
                <span className="mr-2 tabular-nums text-muted-foreground">{i + 1}.</span>
                {section.title}
              </h2>
              <div className="space-y-4">
                {section.blocks.map((block, b) => (
                  <BlockView key={b} block={block} id={`${section.id}-${b}`} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="border-t border-border pt-8 text-sm text-muted-foreground">
          <p>
            If you have questions about these Terms, or wish to report a concern, please contact{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              {CONTACT_EMAIL}
            </a>
            . To review how we protect and process your data, visit our{" "}
            <Link
              href="/privacy"
              className="underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}
