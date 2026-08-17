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

export type RawGmailMessage = {
  messageId: string;
  raw: Buffer;
  subject: string | null;
  from: string | null;
  internalDate: Date | null;
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

function addressFrom(headerText: string | null): string | null {
  if (!headerText) return null;
  const angled = headerText.match(/<([^>]+)>/);
  return (angled ? angled[1] : headerText).trim() || null;
}

export async function listRecentRawGmailMessages(
  gmail: GmailLike,
  opts: { since: Date; max: number }
): Promise<RawGmailMessage[]> {
  const ids: string[] = [];
  const q = `after:${Math.floor(opts.since.getTime() / 1000)}`;

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

  const messages: RawGmailMessage[] = [];
  for (const id of ids) {
    const res = await gmail.users.messages.get({ userId: "me", id, format: "raw" });
    if (!res.data.raw) continue;

    const raw = Buffer.from(res.data.raw, "base64url");
    const headerBlock = raw.toString("utf8").split(/\r?\n\r?\n/, 1)[0] ?? "";

    messages.push({
      messageId: id,
      raw,
      subject: headerValue(headerBlock, "Subject"),
      from: addressFrom(headerValue(headerBlock, "From")),
      internalDate: res.data.internalDate ? new Date(Number(res.data.internalDate)) : null,
    });
  }

  return messages;
}
