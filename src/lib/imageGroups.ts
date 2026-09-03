import type { ImageRow } from "./tauri";

export type ImageTableItem =
  | { kind: "section"; title: string; count: number }
  | { kind: "image"; row: ImageRow };

export function unusedImageIds(rows: ImageRow[]): string[] {
  return rows.filter((row) => !row.in_use).map((row) => row.id);
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function rangeIds(ordered: string[], from: string, to: string): string[] {
  const a = ordered.indexOf(from);
  const b = ordered.indexOf(to);
  if (a < 0 && b < 0) return [];
  if (a < 0) return [to];
  if (b < 0) return [from];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return ordered.slice(lo, hi + 1);
}

export function buildImageTableItems(rows: ImageRow[]): ImageTableItem[] {
  const inUse = rows.filter((row) => row.in_use);
  const unused = rows.filter((row) => !row.in_use);
  const items: ImageTableItem[] = [];
  if (inUse.length > 0) {
    items.push({ kind: "section", title: "In use", count: inUse.length });
    for (const row of inUse) items.push({ kind: "image", row });
  }
  if (unused.length > 0) {
    items.push({ kind: "section", title: "Unused", count: unused.length });
    for (const row of unused) items.push({ kind: "image", row });
  }
  return items;
}