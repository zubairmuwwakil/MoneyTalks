/**
 * Turns a card-request demand signal into a tracked PR against PickMe.
 *
 * DELIBERATELY DOES NOT AUTHOR CARD DATA. The PR adds a sourcing brief — issuer, card name, how
 * many people asked, and the checklist a catalogue entry must satisfy — and nothing else. A human
 * then writes the entry in PickMe, where card semantics live (ECOSYSTEM.md), against issuer pages
 * (D3's sourcing bar), and runs scripts/release-catalogue.sh.
 *
 * Composing rates here instead would rebuild the thing decision 2 deleted: a rate model in the
 * hub. This gets the convenience — authoring starts where the demand signal lands — without
 * moving ownership, which is exactly the split ratified 2026-08-24.
 */

const GITHUB_API = "https://api.github.com";

export interface CatalogueRequestInput {
  issuer: string;
  cardName: string;
  requestCount: number;
}

export type CatalogueRequestResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function brief(input: CatalogueRequestInput, slug: string): string {
  return `# Card request: ${input.cardName}

- **Issuer:** ${input.issuer}
- **Requested by:** ${input.requestCount} ${input.requestCount === 1 ? "person" : "people"}
- **Opened from:** Inunity \`/admin/card-requests\`

## Before this card enters the catalogue

Every rule in \`contracts/card-catalogue.json\` carries \`sourceType: issuerConfirmed\`, a source
URL and a \`lastVerifiedAt\`. That bar is the product (D3, "quality moat"), so this checklist is
the work — not paperwork around it.

- [ ] Earn rates read from the issuer's own terms, with the URL cited in \`sources\`
- [ ] Caps: amount, period (\`calendarMonth\` / \`calendarYear\` / \`accountYear\`), and what earns past the cap
- [ ] FX rate, and any free allowance
- [ ] Annual fee, and the issuer's exact waiver wording if there is one
- [ ] Statement credits: amount, and whether the period is the calendar year or the CARD anniversary
- [ ] \`cardId\` agreed — one id, used by every consumer
- [ ] Rules needing an engine capability declare \`requires\`; permanently unscoreable rules declare \`outOfScope\`. Never a bare \`scoredInV1: false\` — it states no reason and can never turn itself back on
- [ ] \`scripts/release-catalogue.sh\` run, and \`catalogueVersion\` bumped

Suggested id: \`${slug}\`
`;
}

interface GhOptions {
  token: string;
  repo: string;
  fetchImpl?: typeof fetch;
}

async function gh<T>(options: GhOptions, path: string, init?: RequestInit): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    // The body can echo request context; the token never appears in it, and is never logged
    // here or anywhere else — it exists only to ride these Authorization headers.
    const detail = await response.text().catch(() => "");
    throw new Error(`GitHub ${response.status}: ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

export async function openCatalogueRequestPr(
  input: CatalogueRequestInput,
  deps: { token?: string; repo?: string; fetchImpl?: typeof fetch } = {},
): Promise<CatalogueRequestResult> {
  const token = deps.token ?? process.env.CATALOGUE_GITHUB_TOKEN;
  const repo = deps.repo ?? process.env.CATALOGUE_REPO ?? "zubairmuwwakil/PickMe";

  // Fails closed and says so plainly. A missing token is a configuration fact the operator can
  // act on, not something to retry or paper over.
  if (!token) {
    return { ok: false, error: "CATALOGUE_GITHUB_TOKEN is not set — cannot open a PR against " + repo };
  }
  if (!input.issuer.trim() || !input.cardName.trim()) {
    return { ok: false, error: "Issuer and card name are both required" };
  }

  const options: GhOptions = { token, repo, fetchImpl: deps.fetchImpl };
  const slug = slugify(`${input.issuer}-${input.cardName}`);
  const branch = `card-request/${slug}`;
  const filePath = `docs/card-requests/${slug}.md`;

  try {
    const base = await gh<{ object: { sha: string } }>(options, `/repos/${repo}/git/ref/heads/main`);

    try {
      await gh(options, `/repos/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
      });
    } catch (error) {
      // Already requested: the branch exists. That is the same signal arriving twice, not a
      // failure — fall through and let the PR lookup below surface the existing one.
      if (!(error instanceof Error) || !error.message.includes("422")) throw error;
    }

    await gh(options, `/repos/${repo}/contents/${filePath}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `docs(card-requests): ${input.cardName}`,
        content: Buffer.from(brief(input, slug), "utf8").toString("base64"),
        branch,
      }),
    }).catch((error) => {
      // 422 here means the file already exists on the branch with different content; the brief is
      // regenerated from the same inputs, so there is nothing new to say.
      if (!(error instanceof Error) || !error.message.includes("422")) throw error;
    });

    const existing = await gh<Array<{ html_url: string }>>(
      options,
      `/repos/${repo}/pulls?head=${encodeURIComponent(repo.split("/")[0] + ":" + branch)}&state=open`,
    );
    if (existing.length > 0) return { ok: true, url: existing[0].html_url };

    const pr = await gh<{ html_url: string }>(options, `/repos/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `Card request: ${input.cardName} (${input.issuer})`,
        head: branch,
        base: "main",
        body: brief(input, slug),
      }),
    });
    return { ok: true, url: pr.html_url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not open the PR" };
  }
}
