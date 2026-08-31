import type { NotionPage, NotionProperty, NotionRichText } from "./notion";

function property(page: NotionPage, name: string): NotionProperty | undefined {
  return page.properties[name];
}

function richTextValue(items: NotionRichText[] | undefined): string {
  return (items ?? [])
    .map((item) => item.plain_text ?? item.text?.content ?? "")
    .join("")
    .trim();
}

export function readText(page: NotionPage, name: string): string {
  const value = property(page, name);
  return richTextValue(value?.rich_text ?? value?.title);
}

export function readNumber(page: NotionPage, name: string): number | null {
  const value = property(page, name)?.number;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readInteger(page: NotionPage, name: string): number | null {
  const value = readNumber(page, name);
  return value === null ? null : Math.trunc(value);
}

export function readCheckbox(page: NotionPage, name: string): boolean {
  return property(page, name)?.checkbox === true;
}

export function readSelect(page: NotionPage, name: string): string | null {
  const nameValue = property(page, name)?.select?.name;
  return typeof nameValue === "string" && nameValue.trim() ? nameValue.trim() : null;
}

export function readDate(page: NotionPage, name: string): Date | null {
  const raw = property(page, name)?.date?.start;
  if (!raw) return null;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

export function readRelationIds(page: NotionPage, name: string): string[] {
  return (property(page, name)?.relation ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function notionPageDataSourceId(page: NotionPage): string | null {
  return page.parent?.data_source_id ?? null;
}

export function notionPageEditedAt(page: NotionPage): Date | null {
  if (!page.last_edited_time) return null;
  const value = new Date(page.last_edited_time);
  return Number.isNaN(value.getTime()) ? null : value;
}
