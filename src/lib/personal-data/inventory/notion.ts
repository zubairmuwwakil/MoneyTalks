import "server-only";

import { setTimeout as sleep } from "node:timers/promises";

import { notionInventoryConfig } from "./config";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const MAX_ATTEMPTS = 4;

export type NotionRichText = {
  plain_text?: string;
  text?: { content?: string };
};

export type NotionProperty = {
  type?: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  number?: number | null;
  checkbox?: boolean;
  select?: { name?: string } | null;
  date?: { start?: string | null; end?: string | null } | null;
  relation?: Array<{ id: string }>;
};

export type NotionPage = {
  object: "page";
  id: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  parent?: {
    type?: string;
    data_source_id?: string;
    database_id?: string;
    page_id?: string;
  };
  properties: Record<string, NotionProperty>;
};

type NotionListResponse = {
  object: "list";
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
};

export class NotionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  }
  return Math.min(8_000, 300 * 2 ** attempt);
}

async function notionFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = notionInventoryConfig();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${NOTION_API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
          ...init?.headers,
        },
        cache: "no-store",
      });

      if (response.ok) return (await response.json()) as T;

      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        throw new NotionApiError(`Notion API ${response.status} for ${path}`, response.status, body);
      }
      await sleep(retryDelayMs(response, attempt));
    } catch (error) {
      if (error instanceof NotionApiError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === MAX_ATTEMPTS - 1) break;
      await sleep(Math.min(8_000, 300 * 2 ** attempt));
    }
  }

  throw lastError ?? new Error(`Notion API request failed for ${path}`);
}

export async function retrieveNotionPage(pageId: string): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${encodeURIComponent(pageId)}`);
}

export async function queryNotionDataSource(dataSourceId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let startCursor: string | null = null;

  do {
    const response: NotionListResponse = await notionFetch<NotionListResponse>(
      `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
          ...(startCursor ? { start_cursor: startCursor } : {}),
        }),
      },
    );
    pages.push(...response.results.filter((result: NotionPage) => result.object === "page"));
    startCursor = response.has_more ? response.next_cursor : null;
  } while (startCursor);

  return pages;
}

export async function updateNotionPageProperties(
  pageId: string,
  properties: Record<string, unknown>,
): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

export async function createNotionDataSourcePage(
  dataSourceId: string,
  properties: Record<string, unknown>,
): Promise<NotionPage> {
  return notionFetch<NotionPage>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties,
    }),
  });
}

export function notionTitle(value: string): unknown {
  return { title: [{ type: "text", text: { content: value } }] };
}

export function notionRichText(value: string | null | undefined): unknown {
  return value
    ? { rich_text: [{ type: "text", text: { content: value } }] }
    : { rich_text: [] };
}

export function notionNumber(value: number | null): unknown {
  return { number: value };
}

export function notionCheckbox(value: boolean): unknown {
  return { checkbox: value };
}

export function notionSelect(value: string | null | undefined): unknown {
  return { select: value ? { name: value } : null };
}

export function notionDate(value: Date | null): unknown {
  return { date: value ? { start: value.toISOString() } : null };
}

export function notionRelation(pageIds: string[]): unknown {
  return { relation: pageIds.map((id) => ({ id })) };
}
