import type { ImageRow } from "./tauri";

export type ImageTableItem =
  | { kind: "section"; title: string; count: number }
  | { kind: "image"; row: ImageRow };

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
