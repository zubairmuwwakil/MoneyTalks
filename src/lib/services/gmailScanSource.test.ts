import { it, expect } from "vitest";

import { hasGmailReadScope, listRecentRawGmailMessages } from "./gmailScanSource";

// The exact scope string observed in prod when the user skips the Gmail
// checkbox on Google's granular-consent screen: profile-only, no mail access.
const PROFILE_ONLY_SCOPE =
  "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid";

it("rejects a grant with no Gmail scope", () => {
  expect(hasGmailReadScope(PROFILE_ONLY_SCOPE)).toBe(false);
  expect(hasGmailReadScope(null)).toBe(false);
  expect(hasGmailReadScope(undefined)).toBe(false);
  expect(hasGmailReadScope("")).toBe(false);
});

it("accepts a grant containing gmail.readonly or full mail scope", () => {
  expect(hasGmailReadScope(`${PROFILE_ONLY_SCOPE} https://www.googleapis.com/auth/gmail.readonly`)).toBe(true);
  expect(hasGmailReadScope("https://mail.google.com/")).toBe(true);
});

type ListCall = { q?: string; maxResults?: number; pageToken?: string };

function mimeMessage(subject: string, from: string) {
  return [
    `From: Shop <${from}>`,
    "To: buyer@example.com",
    `Subject: ${subject}`,
    "Content-Type: text/plain",
    "",
    "Thanks for your order!",
  ].join("\r\n");
}

function fakeGmail(pages: { id: string; raw?: string; internalDate?: string }[][]) {
  const listCalls: ListCall[] = [];
  const getCalls: { userId: string; id: string; format?: string }[] = [];
  const byId = new Map(pages.flat().map((m) => [m.id, m]));

  const gmail = {
    users: {
      messages: {
        list: async (params: ListCall) => {
          listCalls.push(params);
          const page = params.pageToken ? Number(params.pageToken) : 0;
          return {
            data: {
              messages: (pages[page] ?? []).map((m) => ({ id: m.id })),
              nextPageToken: page + 1 < pages.length ? String(page + 1) : undefined,
            },
          };
        },
        get: async (params: { userId: string; id: string; format?: string }) => {
          getCalls.push(params);
          const msg = byId.get(params.id);
          return { data: { raw: msg?.raw, internalDate: msg?.internalDate } };
        },
      },
    },
  };

  return { gmail, listCalls, getCalls };
}

it("lists messages since the cutoff and maps raw content, headers, and dates", async () => {
  const mime = mimeMessage("Your Amazon order", "order@amazon.ca");
  const { gmail, listCalls, getCalls } = fakeGmail([
    [{ id: "m1", raw: Buffer.from(mime).toString("base64url"), internalDate: "1755300000000" }],
  ]);

  const since = new Date("2026-05-19T00:00:00.000Z");
  const messages = await listRecentRawGmailMessages(gmail, { since, max: 200 });

  expect(listCalls[0]?.q).toBe(`after:${Math.floor(since.getTime() / 1000)}`);
  expect(getCalls).toEqual([{ userId: "me", id: "m1", format: "raw" }]);

  expect(messages).toHaveLength(1);
  expect(messages[0].messageId).toBe("m1");
  expect(messages[0].raw.toString("utf8")).toBe(mime);
  expect(messages[0].subject).toBe("Your Amazon order");
  expect(messages[0].from).toBe("order@amazon.ca");
  expect(messages[0].internalDate).toEqual(new Date(1755300000000));
});

it("pages through results and stops at the max cap", async () => {
  const raw = Buffer.from(mimeMessage("s", "a@b.c")).toString("base64url");
  const { gmail, listCalls } = fakeGmail([
    [{ id: "a", raw }, { id: "b", raw }],
    [{ id: "c", raw }, { id: "d", raw }],
  ]);

  const messages = await listRecentRawGmailMessages(gmail, { since: new Date(0), max: 3 });

  expect(messages.map((m) => m.messageId)).toEqual(["a", "b", "c"]);
  expect(listCalls).toHaveLength(2);
});

it("skips messages whose raw body is missing", async () => {
  const raw = Buffer.from(mimeMessage("s", "a@b.c")).toString("base64url");
  const { gmail } = fakeGmail([[{ id: "gone" }, { id: "ok", raw }]]);

  const messages = await listRecentRawGmailMessages(gmail, { since: new Date(0), max: 10 });

  expect(messages.map((m) => m.messageId)).toEqual(["ok"]);
});
