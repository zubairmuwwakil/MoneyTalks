import "server-only";

import { Client } from "@upstash/qstash";

export type ContinuationResult =
  | { queued: true; messageId: string }
  | { queued: false; reason: "not-configured" };

function baseUrl(): string | null {
  const value = process.env.CRON_BASE_URL?.trim() || process.env.APP_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

export function isQstashContinuationConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN?.trim() && baseUrl());
}

/**
 * Enqueue a bounded continuation of a cron sweep. The route remains protected
 * by the existing QStash signature verifier; deduplication makes retries safe
 * when a delivery succeeds but the response is lost.
 */
export async function enqueueCronContinuation<TBody>(args: {
  path: string;
  body: TBody;
  deduplicationId: string;
}): Promise<ContinuationResult> {
  const token = process.env.QSTASH_TOKEN?.trim();
  const destination = baseUrl();
  if (!token || !destination) return { queued: false, reason: "not-configured" };

  const client = new Client({
    token,
    baseUrl: process.env.QSTASH_URL?.trim() || undefined,
  });
  const response = await client.publishJSON({
    url: `${destination}${args.path}`,
    body: args.body,
    method: "POST",
    retries: 3,
    timeout: 110,
    deduplicationId: `in-unity:${args.deduplicationId}`,
    headers: { "Content-Type": "application/json" },
  });

  return { queued: true, messageId: response.messageId };
}
