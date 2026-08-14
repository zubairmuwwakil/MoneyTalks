# MoneyTalks Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, login-protected Next.js shell on Vercel — the owner can log in from a phone to an empty five-module app with a working test pipeline underneath.

**Architecture:** One Next.js (App Router) codebase with three strict layers: pure-TypeScript domain engines in `src/engine/` (established here with a money-formatting seed), a Prisma/Neon Postgres data layer (auth models only in Phase 0), and server-component UI. Auth.js provides magic-link login (passkey added as an experimental enhancement) with a closed allowlist; every protected page and API route enforces auth server-side via one shared helper.

**Tech Stack:** Next.js 15 (App Router) + TypeScript strict + Tailwind v4 + shadcn/ui, Prisma 6 + Neon Postgres, Auth.js (next-auth v5 beta) + Resend + @simplewebauthn v9, Vitest, Playwright, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-14-moneytalks-design.md`

## Global Constraints

- **Public portfolio repo — zero personal data in any committed file, including this plan.** Owner-specific values (emails, keys, URLs) exist only in `.env.local`, Vercel env vars, or `docs/private/` (gitignored). Before any push: `git show` the commits and grep for personal tokens.
- Money is integer minor units (cents) + ISO currency code — never floats. Dates are ISO 8601 strings. Timezone `America/Toronto`.
- `src/engine/` is pure TypeScript: zero I/O, no imports from Next.js/Prisma/React. Business logic never lives in API route handlers.
- TypeScript `strict: true` (create-next-app default — do not weaken).
- Auth: registration closed — only emails in `ALLOWED_EMAILS` may sign in. Sessions are httpOnly cookies (Auth.js default). Unauthenticated API access returns 401.
- **Naming:** the Prisma model `Account` is reserved by the Auth.js adapter. The financial account model (Phase 1) MUST be named `FinancialAccount`.
- Node 20+. Package manager: npm.
- Every commit message ends with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Tasks marked **OWNER CHECKPOINT** need the owner to create an external account/value or grant permission (e.g., pushing). Stop and ask; do not work around.

---

### Task 1: Scaffold Next.js into the existing repo

The repo already contains `README.md`, `.gitignore`, and `docs/` — `create-next-app` refuses non-empty directories, so scaffold into a temp subfolder and merge.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css` (via scaffold)
- Modify: `.gitignore` (merge scaffold entries below the existing secret-blocking rules)

**Interfaces:**
- Produces: a running Next.js app with `@/*` → `src/*` import alias; `npm run dev`, `npm run build`, `npm run lint` all work.

- [ ] **Step 1: Scaffold in a temp dir and merge**

```bash
cd /Users/zub/Documents/Github_Projects/MoneyTalks
npx create-next-app@latest scaffold-tmp --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack --use-npm --yes
rsync -a --exclude node_modules --exclude .git --exclude README.md --exclude .gitignore scaffold-tmp/ ./
cat scaffold-tmp/.gitignore >> .gitignore
rm -rf scaffold-tmp
npm install
```

- [ ] **Step 2: Deduplicate `.gitignore`**

Open `.gitignore`; keep the secret-blocking block (`.env*`, `seed/`, `*.seed.json`, `seed-data.json`, `docs/private/`) at the top, remove duplicate lines from the appended scaffold block (e.g., a second `.env*`, `node_modules/`, `.next/`). The final file must still contain every pattern from both sources exactly once.

- [ ] **Step 3: Verify dev server**

Run: `npm run dev` — open http://localhost:3000, expect the Next.js starter page. Stop the server.
Run: `npm run build` — expect a successful production build.

- [ ] **Step 4: Replace starter page with a placeholder**

Replace the body of `src/app/page.tsx` entirely with:

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">MoneyTalks</h1>
    </main>
  );
}
```

In `src/app/layout.tsx`, set the metadata export to:

```tsx
export const metadata: Metadata = {
  title: "MoneyTalks",
  description: "Personal finance command center",
};
```

Run: `npm run dev`, confirm the page renders "MoneyTalks". Stop the server.

- [ ] **Step 5: Commit**

```bash
git add -A
git status   # VERIFY: no .env*, seed*, or docs/private/ files staged
git commit -m "chore: scaffold Next.js 15 app (TS, Tailwind, App Router)"
```

---

### Task 2: Test infrastructure + money engine seed

Establishes `src/engine/` (pure functions) and Vitest, using the app's first real utility: formatting integer minor units for display.

**Files:**
- Create: `vitest.config.ts`, `src/engine/money.ts`, `src/engine/money.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `formatMinorUnits(amountMinor: number, currency: "CAD" | "USD" | "JMD", locale?: string): string` — throws `RangeError` on non-safe-integer input. Later phases build on this convention: all engine money math takes integer minor units.

- [ ] **Step 1: Install and configure Vitest**

```bash
npm install -D vitest
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
```

Add to `package.json` scripts: `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 2: Write the failing test**

Create `src/engine/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMinorUnits } from "./money";

describe("formatMinorUnits", () => {
  it("formats CAD cents as dollars", () => {
    expect(formatMinorUnits(123456, "CAD")).toBe("$1,234.56");
  });

  it("formats zero", () => {
    expect(formatMinorUnits(0, "CAD")).toBe("$0.00");
  });

  it("formats negative amounts", () => {
    expect(formatMinorUnits(-9900, "CAD")).toBe("-$99.00");
  });

  it("distinguishes USD in a Canadian locale", () => {
    expect(formatMinorUnits(123456, "USD")).toContain("1,234.56");
    expect(formatMinorUnits(123456, "USD")).not.toBe(formatMinorUnits(123456, "CAD"));
  });

  it("rejects non-integer input", () => {
    expect(() => formatMinorUnits(12.34, "CAD")).toThrow(RangeError);
  });

  it("rejects unsafe integers", () => {
    expect(() => formatMinorUnits(Number.MAX_SAFE_INTEGER + 1, "CAD")).toThrow(RangeError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './money'` (or equivalent).

- [ ] **Step 4: Implement**

Create `src/engine/money.ts`:

```ts
export type Currency = "CAD" | "USD" | "JMD";

export function formatMinorUnits(
  amountMinor: number,
  currency: Currency,
  locale = "en-CA",
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(
      `amountMinor must be a safe integer of minor units, got ${amountMinor}`,
    );
  }
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    amountMinor / 100,
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: 6 passing. If the exact-string assertions fail on symbol placement, the runtime's ICU differs — adjust the *expected strings* to the actual `en-CA` output (verify it is sensible), never the implementation.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts src/engine/money.ts src/engine/money.test.ts package.json package-lock.json
git commit -m "feat: add engine money formatting with Vitest infrastructure"
```

---

### Task 3: Prisma + Neon Postgres (auth schema)

**OWNER CHECKPOINT** (mid-task): a Neon database and its connection string.

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/prisma.ts`, `.env.example`
- Modify: `package.json` (postinstall)

**Interfaces:**
- Produces: `prisma` singleton (`import { prisma } from "@/lib/prisma"`); Auth.js-shaped models `User`, `Account`, `Session`, `VerificationToken`, `Authenticator`. Phase 1 adds financial models to this same schema (remember: `FinancialAccount`, never `Account`).

- [ ] **Step 1: Install Prisma**

```bash
npm install prisma @prisma/client
npx prisma init --datasource-provider postgresql
```

`prisma init` creates `prisma/schema.prisma` and appends `DATABASE_URL` to `.env` — delete the generated `.env` (we use `.env.local`; `.env*` is gitignored, but keep the tree clean).

- [ ] **Step 2: Write the schema**

Replace `prisma/schema.prisma` entirely with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---- Auth.js models (shape required by @auth/prisma-adapter) ----
// NOTE: "Account" here is an OAuth/provider account, owned by the adapter.
// Financial accounts (Phase 1) must be modeled as "FinancialAccount".

model User {
  id             String          @id @default(cuid())
  name           String?
  email          String?         @unique
  emailVerified  DateTime?
  image          String?
  accounts       Account[]
  sessions       Session[]
  authenticators Authenticator[]
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
}

model Account {
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([provider, providerAccountId])
}

model Session {
  sessionToken String   @id
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String
  expires    DateTime

  @@id([identifier, token])
}

model Authenticator {
  credentialID         String  @unique
  userId               String
  providerAccountId    String
  credentialPublicKey  String
  counter              Int
  credentialDeviceType String
  credentialBackedUp   Boolean
  transports           String?
  user                 User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, credentialID])
}
```

- [ ] **Step 3: Create the Prisma client singleton**

Create `src/lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: Create `.env.example`** (committed — placeholders only)

```bash
# Copy to .env.local and fill with real values. NEVER commit real values.
DATABASE_URL="postgresql://USER:PASSWORD@HOST/neondb?sslmode=require"
AUTH_SECRET="run: npx auth secret"
AUTH_RESEND_KEY="re_xxxxxxxx"
AUTH_EMAIL_FROM="MoneyTalks <onboarding@resend.dev>"
ALLOWED_EMAILS="you@example.com"
```

- [ ] **Step 5: OWNER CHECKPOINT — Neon database**

Ask the owner to: create a free project at https://neon.tech named `moneytalks`, copy the pooled connection string, and place it in `.env.local` as `DATABASE_URL`. Do not proceed until `.env.local` exists.

- [ ] **Step 6: Run the migration**

```bash
npx dotenv -e .env.local -- npx prisma migrate dev --name auth-models
```

(If `dotenv` is unavailable: `npm install -D dotenv-cli` first. Prisma CLI reads `.env`, not `.env.local`, hence the wrapper.)

Expected: migration applied; `prisma/migrations/<timestamp>_auth-models/` created.

- [ ] **Step 7: Verify schema against the live DB**

```bash
npx dotenv -e .env.local -- npx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 8: Add postinstall generate + commit**

Add to `package.json` scripts: `"postinstall": "prisma generate"`.

```bash
git add prisma/ src/lib/prisma.ts .env.example package.json package-lock.json
git status   # VERIFY: .env.local is NOT staged (gitignored)
git commit -m "feat: add Prisma with Neon Postgres and Auth.js schema"
```

---

### Task 4: Magic-link login with closed allowlist

**OWNER CHECKPOINT** (mid-task): a Resend API key.

**Files:**
- Create: `src/lib/allowlist.ts`, `src/lib/allowlist.test.ts`, `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/require-user.ts`, `src/app/login/page.tsx`, `src/app/api/me/route.ts`, `src/app/api/health/route.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `prisma` from Task 3.
- Produces: `auth`, `signIn`, `signOut`, `handlers` from `@/auth`; `requireUser(): Promise<{ email: string }>` (redirects to `/login` when unauthenticated); `isAllowedEmail(email: string | null | undefined, allowlistCsv: string | undefined): boolean`. Every later page calls `requireUser()`; every later API route follows the `/api/me` 401 pattern.

**Design note — why no middleware:** Prisma cannot run on the Edge runtime where Next.js middleware lives by default, and database sessions can't be validated without the database. Instead of the fragile split-config workaround, enforcement is explicit and server-side: pages call `requireUser()`, API routes check `auth()` and return 401. This is also what the spec's tests require.

- [ ] **Step 1: Write the failing allowlist test**

Create `src/lib/allowlist.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "./allowlist";

describe("isAllowedEmail", () => {
  it("accepts an exact match", () => {
    expect(isAllowedEmail("a@b.com", "a@b.com")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isAllowedEmail(" A@B.COM ", "a@b.com")).toBe(true);
    expect(isAllowedEmail("a@b.com", " A@B.com , c@d.com ")).toBe(true);
  });

  it("supports multiple comma-separated emails", () => {
    expect(isAllowedEmail("c@d.com", "a@b.com,c@d.com")).toBe(true);
  });

  it("rejects emails not on the list", () => {
    expect(isAllowedEmail("evil@x.com", "a@b.com")).toBe(false);
  });

  it("rejects everything when the list is empty or unset", () => {
    expect(isAllowedEmail("a@b.com", "")).toBe(false);
    expect(isAllowedEmail("a@b.com", undefined)).toBe(false);
  });

  it("rejects null/undefined email", () => {
    expect(isAllowedEmail(null, "a@b.com")).toBe(false);
    expect(isAllowedEmail(undefined, "a@b.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./allowlist`.

- [ ] **Step 3: Implement the allowlist**

Create `src/lib/allowlist.ts`:

```ts
export function isAllowedEmail(
  email: string | null | undefined,
  allowlistCsv: string | undefined,
): boolean {
  if (!email) return false;
  const allowed = (allowlistCsv ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: all tests pass (money + allowlist).

- [ ] **Step 5: Install Auth.js and configure**

```bash
npm install next-auth@beta @auth/prisma-adapter
```

Create `src/auth.ts`:

```ts
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/lib/prisma";
import { isAllowedEmail } from "@/lib/allowlist";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  providers: [
    Resend({ from: process.env.AUTH_EMAIL_FROM }),
  ],
  pages: { signIn: "/login", verifyRequest: "/login?sent=1" },
  callbacks: {
    signIn({ user }) {
      return isAllowedEmail(user.email, process.env.ALLOWED_EMAILS);
    },
  },
});
```

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 6: Create the auth helper and protected/public API routes**

Create `src/lib/require-user.ts`:

```ts
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export async function requireUser(): Promise<{ email: string }> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/login");
  return { email };
}
```

Create `src/app/api/me/route.ts`:

```ts
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({ email: session.user.email });
}
```

Create `src/app/api/health/route.ts`:

```ts
export async function GET() {
  return Response.json({ ok: true });
}
```

- [ ] **Step 7: Build the login page**

Create `src/app/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { sent, error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">MoneyTalks</h1>
        {sent ? (
          <p className="text-sm">
            Check your email — a sign-in link is on its way.
          </p>
        ) : (
          <form
            action={async (formData: FormData) => {
              "use server";
              await signIn("resend", {
                email: formData.get("email"),
                redirectTo: "/",
              });
            }}
            className="space-y-3"
          >
            <label className="block text-sm" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded border px-3 py-2"
            />
            <button
              type="submit"
              className="w-full rounded bg-foreground px-3 py-2 text-background"
            >
              Send sign-in link
            </button>
          </form>
        )}
        {error ? (
          <p className="text-sm text-red-600">Sign-in failed. Try again.</p>
        ) : null}
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Protect the home page**

Replace `src/app/page.tsx` entirely with:

```tsx
import { requireUser } from "@/lib/require-user";
import { signOut } from "@/auth";

export default async function Home() {
  const user = await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">MoneyTalks</h1>
      <p className="text-sm">Signed in as {user.email}</p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="rounded border px-3 py-1 text-sm">
          Sign out
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 9: OWNER CHECKPOINT — Resend key + env values**

Ask the owner to: create a free account at https://resend.com, generate an API key, and fill `.env.local`:

- `AUTH_RESEND_KEY` — the API key
- `AUTH_EMAIL_FROM` — `MoneyTalks <onboarding@resend.dev>` (Resend's shared test sender; delivers only to the account owner's email — exactly right for a closed allowlist. A custom domain is optional later.)
- `AUTH_SECRET` — output of `npx auth secret` (it writes `.env.local` itself if run in the repo)
- `ALLOWED_EMAILS` — the owner's email (the same one used for the Resend account)

- [ ] **Step 10: Verify the full loop manually**

Run: `npm run dev`. In a browser: visit http://localhost:3000 → expect redirect to `/login`. Submit the owner's email → expect the "check your email" state → click the link in the received email → expect redirect to `/` showing "Signed in as …". Then visit http://localhost:3000/api/me in the same browser → expect the email JSON. Sign out → expect `/login`. Finally, submit a *different* email address → expect sign-in refusal (error state, no email delivered).

- [ ] **Step 11: Run all tests, lint, build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add src/ package.json package-lock.json
git status   # VERIFY: no .env* staged
git commit -m "feat: add magic-link auth with closed allowlist"
```

---

### Task 5: Passkey login (experimental enhancement)

Magic link is the reliable path; this adds passkeys per the spec. Auth.js WebAuthn support is **experimental** — before implementing, check https://authjs.dev/getting-started/authentication/webauthn for API drift. If it has shifted materially, stop and re-plan this task; the app remains fully usable via magic link.

**Files:**
- Create: `src/components/passkey-buttons.tsx`
- Modify: `src/auth.ts`, `src/app/login/page.tsx`, `src/app/page.tsx`

**Interfaces:**
- Consumes: `auth` config from Task 4; `Authenticator` model from Task 3.
- Produces: passkey registration (from the signed-in home page) and passkey sign-in (from the login page).

- [ ] **Step 1: Install WebAuthn dependencies (versions pinned per Auth.js docs)**

```bash
npm install @simplewebauthn/browser@9.0.1 @simplewebauthn/server@9.0.3
```

- [ ] **Step 2: Enable the provider**

In `src/auth.ts`: add `import Passkey from "next-auth/providers/passkey";`, add `Passkey` to the `providers` array, and add `experimental: { enableWebAuthn: true },` at the top level of the NextAuth config object.

- [ ] **Step 3: Create the client buttons**

Create `src/components/passkey-buttons.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/webauthn";

export function PasskeySignInButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("passkey")}
      className="w-full rounded border px-3 py-2"
    >
      Sign in with a passkey
    </button>
  );
}

export function PasskeyRegisterButton() {
  return (
    <button
      type="button"
      onClick={() => signIn("passkey", { action: "register" })}
      className="rounded border px-3 py-1 text-sm"
    >
      Register a passkey on this device
    </button>
  );
}
```

- [ ] **Step 4: Wire into pages**

In `src/app/login/page.tsx`: import `PasskeySignInButton` and render it directly below the email form (inside the non-`sent` branch).
In `src/app/page.tsx`: import `PasskeyRegisterButton` and render it below the signed-in email line.

- [ ] **Step 5: Verify manually**

Run: `npm run dev`. Sign in via magic link, click "Register a passkey on this device" → complete the browser prompt (Touch ID). Sign out. On `/login`, click "Sign in with a passkey" → expect a successful session without email. Note: passkeys are origin-bound — this localhost passkey is separate from the one the owner will register on the production domain in Task 8.

- [ ] **Step 6: Run tests + build, commit**

Run: `npm test && npm run build`
Expected: pass.

```bash
git add src/ package.json package-lock.json
git commit -m "feat: add experimental passkey login"
```

---

### Task 6: App shell — nav, module placeholders, PWA manifest

**Files:**
- Create: `src/components/nav.tsx`, `src/app/manifest.ts`, `src/app/investments/page.tsx`, `src/app/bills/page.tsx`, `src/app/cards/page.tsx`, `src/app/money-finder/page.tsx`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`

**Interfaces:**
- Consumes: `requireUser` from Task 4.
- Produces: the five-route shell every later phase fills in: `/` (Dashboard), `/investments`, `/bills`, `/cards`, `/money-finder`.

- [ ] **Step 1: Initialize shadcn/ui**

```bash
npx shadcn@latest init --yes -b neutral
npx shadcn@latest add button
```

If `init` prompts anyway, accept defaults (New York style is fine). This creates `components.json`, `src/lib/utils.ts`, and `src/components/ui/button.tsx`.

- [ ] **Step 2: Build the nav**

Create `src/components/nav.tsx`:

```tsx
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
```

- [ ] **Step 3: Mount the nav in the layout**

In `src/app/layout.tsx`, render `<Nav />` as the first child of `<body>`, and wrap `{children}` in `<div className="mx-auto max-w-4xl px-4 pb-20 sm:pb-4">{children}</div>`. The nav renders on every page including `/login` — acceptable for Phase 0 (all targets redirect to `/login` when signed out).

- [ ] **Step 4: Create the four module placeholder pages**

Create `src/app/investments/page.tsx`:

```tsx
import { requireUser } from "@/lib/require-user";

export default async function InvestmentsPage() {
  await requireUser();
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Investments</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase 1.</p>
    </main>
  );
}
```

Create `src/app/bills/page.tsx`:

```tsx
import { requireUser } from "@/lib/require-user";

export default async function BillsPage() {
  await requireUser();
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Bills</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase 3.</p>
    </main>
  );
}
```

Create `src/app/cards/page.tsx`:

```tsx
import { requireUser } from "@/lib/require-user";

export default async function CardsPage() {
  await requireUser();
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Cards</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase 4.</p>
    </main>
  );
}
```

Create `src/app/money-finder/page.tsx`:

```tsx
import { requireUser } from "@/lib/require-user";

export default async function MoneyFinderPage() {
  await requireUser();
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Money Finder</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in Phase 2.</p>
    </main>
  );
}
```

- [ ] **Step 5: Restyle the dashboard placeholder**

Replace the `return` in `src/app/page.tsx` with the same page pattern (keep `requireUser` and the sign-out form from Task 4, plus `PasskeyRegisterButton` from Task 5):

```tsx
  return (
    <main className="py-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user.email}. Net worth, alerts, and upcoming payments
        arrive in Phase 1–2.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <PasskeyRegisterButton />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="rounded border px-3 py-1 text-sm">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
```

- [ ] **Step 6: Add the PWA manifest**

Create `src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MoneyTalks",
    short_name: "MoneyTalks",
    description: "Personal finance command center",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [],
  };
}
```

(Icons and the service worker are Phase 5 — "Add to Home Screen" works from the browser menu without them.)

- [ ] **Step 7: Verify manually**

Run: `npm run dev`. Signed in: all five nav links work, active link is highlighted, nav is a bottom bar on a narrow window and a top bar on a wide one. http://localhost:3000/manifest.webmanifest returns the manifest JSON.

- [ ] **Step 8: Run tests + build, commit**

Run: `npm test && npm run lint && npm run build`
Expected: pass.

```bash
git add src/ components.json package.json package-lock.json
git commit -m "feat: add app shell with nav, module placeholders, PWA manifest"
```

---

### Task 7: Playwright smoke tests

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json` (script), `.gitignore` (Playwright artifacts)

**Interfaces:**
- Consumes: the running app (Tasks 4/6): `/` redirect behavior, `/login` form, `/api/me`, `/api/health`.
- Produces: `npm run e2e` — the regression gate later phases extend.

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Add to `package.json` scripts: `"e2e": "playwright test"`.
Append to `.gitignore` (bottom section): `test-results/` and `playwright-report/`.

- [ ] **Step 2: Configure with a managed dev server**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Write the smoke tests**

Create `e2e/smoke.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("unauthenticated visit to / redirects to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("button", { name: /send sign-in link/i }),
  ).toBeVisible();
});

test("module pages are protected", async ({ page }) => {
  for (const path of ["/investments", "/bills", "/cards", "/money-finder"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("protected API returns 401 when unauthenticated", async ({ request }) => {
  const res = await request.get("/api/me");
  expect(res.status()).toBe(401);
});

test("health endpoint is public", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 4: Run and verify**

Run: `npm run e2e`
Expected: 4 passing. (Requires `.env.local` from Tasks 3–4 so the dev server boots with a database.)

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e/ package.json package-lock.json .gitignore
git commit -m "test: add Playwright smoke tests for auth boundaries"
```

---

### Task 8: Deploy to Vercel

**OWNER CHECKPOINT** (whole task): pushing to GitHub and creating the Vercel project are owner-gated actions.

**Files:**
- Modify: `package.json` (build script), `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the live site; production DB migrated; the Phase-0 "done" state — owner logs in from a phone.

- [ ] **Step 1: Make the build run migrations**

In `package.json`, change the build script to:

```json
"build": "prisma migrate deploy && next build"
```

Local `npm run build` now needs `DATABASE_URL` — verify with:
`npx dotenv -e .env.local -- npm run build` → expect success.

- [ ] **Step 2: Update the README** (public-safe; this is the portfolio front door)

Replace `README.md` contents with:

```markdown
# MoneyTalks

A personal finance command center: investments, bills, credit cards, and a
rules engine that surfaces cross-border compliance triggers and money
opportunities (grants, credits, benefit thresholds).

- **Stack:** Next.js (App Router) · TypeScript · Tailwind + shadcn/ui ·
  Prisma + Postgres (Neon) · Auth.js (passkeys + magic link) · Vercel
- **Design spec:** [`docs/superpowers/specs/2026-08-14-moneytalks-design.md`](docs/superpowers/specs/2026-08-14-moneytalks-design.md)
- **Privacy by construction:** the repo contains zero personal data — all
  personal records enter at runtime through an authenticated import path,
  and registration is closed by allowlist.

## Development

    cp .env.example .env.local   # fill in real values
    npm install
    npx dotenv -e .env.local -- npx prisma migrate dev
    npm run dev

Tests: `npm test` (engines) · `npm run e2e` (smoke)
```

- [ ] **Step 3: Commit, pre-push audit, push**

```bash
git add package.json README.md
git commit -m "chore: production build migrations and README"
```

Pre-push audit (Global Constraints): `git log --oneline origin/main..HEAD` then for the full diff `git diff origin/main..HEAD | grep -i -E "<owner name>|<owner emails>|re_[A-Za-z0-9]|postgresql://"` — expect no personal values or secrets (schema field names like `email` are fine).

Then ask the owner for permission to push, and:

```bash
git push origin main
```

- [ ] **Step 4: OWNER CHECKPOINT — create the Vercel project**

Ask the owner to: log into https://vercel.com → Add New Project → import `zubairmuwwakil/MoneyTalks` → before deploying, add Environment Variables (Production): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `ALLOWED_EMAILS` — same values as `.env.local` → Deploy.

- [ ] **Step 5: Verify production**

On the deployed URL: `/` redirects to `/login`; magic-link sign-in works end-to-end; `/api/me` returns 401 in a fresh private window and the email JSON when signed in; `/api/health` returns `{"ok":true}`; a non-allowlisted email is refused. On the owner's phone: log in, then register a passkey from the dashboard (production passkey is separate from the localhost one), sign out, sign back in with the passkey. Optionally: Add to Home Screen.

- [ ] **Step 6: Mark Phase 0 done**

Confirm every checkbox in this plan is checked. Phase 0's spec definition of done: *the owner logs in on their phone to an empty shell.* If true, proceed to planning Phase 1 (Investments).

---

## Self-review notes

- **Spec coverage (Phase 0 row):** scaffold (T1), Prisma schema (T3), passkey login (T4 magic link + T5 passkey), Vercel pipeline (T8), shell with nav (T6). Spec's testing requirements for this phase: engine test infra (T2), 401 auth-guard + login redirect E2E (T7). ✔
- **Type consistency:** `requireUser` returns `{ email: string }` and is consumed as such in T6 pages; `isAllowedEmail(email, allowlistCsv)` signature matches between T4 steps; `prisma` singleton import path `@/lib/prisma` consistent. ✔
- **Known risk, stated in-plan:** Auth.js WebAuthn is experimental (T5 carries a check-docs-first instruction and a safe fallback); shadcn `init` flags may prompt interactively (T6 says accept defaults).
