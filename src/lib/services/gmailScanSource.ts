//gmail REST scan source: list + fetch raw messages for the automation scan

const GMAIL_READ_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://mail.google.com/",
];

// Google's granular-consent screen lets a user approve the login while
// unchecking Gmail access; the stored grant then has no mail scope at all.
export function hasGmailReadScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  return GMAIL_READ_SCOPES.some((s) => scope.includes(s));
}

// Receipt-shaped subject terms, used to catch senders Gmail does not file
// under its own purchases category.
const RECEIPT_TERMS = [
  "receipt",
  "invoice",
  '"order confirmation"',
  '"your order"',
  '"order number"',
  '"payment received"',
  '"payment confirmation"',
  "statement",
];

/**
 * Narrow the scan to mail that could plausibly be a receipt.
 *
 * The first real scan ran an unfiltered `after:<ts>` and pulled 100 messages
 * of which ~95 were newsletters. Excluding the promotions and social tabs
 * removes bulk marketing outright; the rest is Gmail's own purchases
 * classification plus explicit receipt wording in the subject.
 */
export function buildReceiptQuery(since: Date): string {
  const after = `after:${Math.floor(since.getTime() / 1000)}`;
  const subjectTerms = `subject:(${RECEIPT_TERMS.join(" OR ")})`;
  return `${after} -category:promotions -category:social (category:purchases OR ${subjectTerms})`;
}

export type RawGmailMessage = {
  messageId: string;
  raw: Buffer;
  subject: string | null;
  from: string | null;
  internalDate: Date | null;
  rfc822MessageId: string | null;
};

type GmailLike = {
  users: {
    messages: {
      list(params: {
        userId: string;
        q?: string;
        maxResults?: number;
        pageToken?: string;
      }): Promise<{ data: { messages?: { id?: string | null }[] | null; nextPageToken?: string | null } }>;
      get(params: {
        userId: string;
        id: string;
        format?: string;
      }): Promise<{ data: { raw?: string | null; internalDate?: string | null } }>;
    };
  };
};

function headerValue(headerBlock: string, name: string): string | null {
  // Unfold continuation lines (RFC 5322) before matching.
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  const m = unfolded.match(new RegExp(`^${name}:[ \\t]*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

/**
 * The RFC822 `Message-ID` header, which the SENDER assigns and which is
 * therefore identical in every mailbox the message reaches. Gmail's own
 * message id is per-mailbox, so it cannot tell "the same receipt, twice"
 * from "two receipts".
 *
 * Only the header block is searched: a forwarded receipt quotes the original
 * headers in its body, and reading those would give two genuinely different
 * messages one identity. An empty `<>` is treated as absent for the same
 * reason — a shared placeholder id would merge unrelated receipts.
 */
export function extractRfc822MessageId(raw: string): string | null {
  const headerBlock = raw.split(/\r?\n\r?\n/, 1)[0] ?? "";
  const value = headerValue(headerBlock, "Message-ID");
  if (!value) return null;
  const angled = value.match(/<([^>]*)>/);
  return (angled ? angled[1] : value).trim() || null;
}

function addressFrom(headerText: string | null): string | null {
  if (!headerText) return null;
  const angled = headerText.match(/<([^>]+)>/);
  return (angled ? angled[1] : headerText).trim() || null;
}

export async function listRecentRawGmailMessages(
  gmail: GmailLike,
  opts: { since: Date; max: number } | { messageIds: readonly string[] }
): Promise<RawGmailMessage[]> {
  let ids: string[];

  if ("messageIds" in opts) {
    // Reprocessing must address the rows already in our database directly.
    // Running today's receipt query again could omit legacy messages that an
    // older, broader scan ingested — precisely the rows reprocessing repairs.
    ids = [...new Set(opts.messageIds)];
  } else {
    ids = [];
    const q = buildReceiptQuery(opts.since);

    let pageToken: string | undefined;
    do {
      const res = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: Math.min(opts.max - ids.length, 100),
        pageToken,
      });
      for (const m of res.data.messages ?? []) {
        if (m.id) ids.push(m.id);
        if (ids.length >= opts.max) break;
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < opts.max);
  }

  const messages: RawGmailMessage[] = [];
  for (const id of ids) {
    const res = await gmail.users.messages.get({ userId: "me", id, format: "raw" });
    if (!res.data.raw) continue;

    const raw = Buffer.from(res.data.raw, "base64url");
    const text = raw.toString("utf8");
    const headerBlock = text.split(/\r?\n\r?\n/, 1)[0] ?? "";

    messages.push({
      messageId: id,
      raw,
      subject: headerValue(headerBlock, "Subject"),
      from: addressFrom(headerValue(headerBlock, "From")),
      internalDate: res.data.internalDate ? new Date(Number(res.data.internalDate)) : null,
      rfc822MessageId: extractRfc822MessageId(text),
    });
  }

  return messages;
}
