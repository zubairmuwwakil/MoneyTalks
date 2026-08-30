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

/** The receipt query bounded at both ends, for walking history backwards. */
export function buildReceiptQueryForWindow(after: Date, before: Date): string {
  const afterTerm = `after:${Math.floor(after.getTime() / 1000)}`;
  const beforeTerm = `before:${Math.floor(before.getTime() / 1000)}`;
  const subjectTerms = `subject:(${RECEIPT_TERMS.join(" OR ")})`;
  return `${afterTerm} ${beforeTerm} -category:promotions -category:social (category:purchases OR ${subjectTerms})`;
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

type RawGmailResponse = {
  raw?: string | null;
  internalDate?: string | null;
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

function parseRawGmailMessage(id: string, data: RawGmailResponse): RawGmailMessage | null {
  if (!data.raw) return null;

  const raw = Buffer.from(data.raw, "base64url");
  const text = raw.toString("utf8");
  const headerBlock = text.split(/\r?\n\r?\n/, 1)[0] ?? "";

  return {
    messageId: id,
    raw,
    subject: headerValue(headerBlock, "Subject"),
    from: addressFrom(headerValue(headerBlock, "From")),
    internalDate: data.internalDate ? new Date(Number(data.internalDate)) : null,
    rfc822MessageId: extractRfc822MessageId(text),
  };
}

async function getRawGmailMessage(gmail: GmailLike, id: string): Promise<RawGmailMessage | null> {
  const res = await gmail.users.messages.get({ userId: "me", id, format: "raw" });
  return parseRawGmailMessage(id, res.data);
}

async function listGmailMessageIds(gmail: GmailLike, q: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(max - ids.length, 100),
      pageToken,
    });
    for (const message of res.data.messages ?? []) {
      if (message.id) ids.push(message.id);
      if (ids.length >= max) break;
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < max);

  return ids;
}

async function getRawGmailMessagesConcurrently(
  gmail: GmailLike,
  ids: readonly string[],
  concurrency: number,
): Promise<RawGmailMessage[]> {
  const messages: (RawGmailMessage | undefined)[] = new Array(ids.length);
  const workerCount = Math.min(ids.length, Math.max(1, Math.floor(concurrency)));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < ids.length) {
      const index = nextIndex;
      nextIndex += 1;
      const id = ids[index];

      try {
        const message = await getRawGmailMessage(gmail, id);
        if (message) messages[index] = message;
      } catch (error) {
        console.warn(`[gmail] failed to fetch message ${id}; skipping`, error);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return messages.filter((message): message is RawGmailMessage => message !== undefined);
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
    ids = await listGmailMessageIds(gmail, buildReceiptQuery(opts.since), opts.max);
  }

  const messages: RawGmailMessage[] = [];
  for (const id of ids) {
    const message = await getRawGmailMessage(gmail, id);
    if (message) messages.push(message);
  }

  return messages;
}

export async function listRawGmailMessagesInWindow(
  gmail: GmailLike,
  opts: { after: Date; before: Date; max: number; concurrency?: number },
): Promise<RawGmailMessage[]> {
  const ids = await listGmailMessageIds(gmail, buildReceiptQueryForWindow(opts.after, opts.before), opts.max);
  return getRawGmailMessagesConcurrently(gmail, ids, opts.concurrency ?? 8);
}
