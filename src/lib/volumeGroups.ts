import { rangeIds, toggleId } from "./imageGroups";
import type { VolumeRow } from "./tauri";

export type VolumeTableItem =
  | { kind: "section"; title: string; count: number }
  | { kind: "volume"; row: VolumeRow };

export function unusedVolumeNames(rows: VolumeRow[]): string[] {
  return rows.filter((row) => row.in_use === false).map((row) => row.name);
}

export function buildVolumeTableItems(rows: VolumeRow[]): VolumeTableItem[] {
  const inUse = rows.filter((row) => row.in_use !== false);
  const unused = rows.filter((row) => row.in_use === false);
  const items: VolumeTableItem[] = [];
  if (inUse.length > 0) {
    items.push({ kind: "section", title: "In use", count: inUse.length });
    for (const row of inUse) items.push({ kind: "volume", row });
  }
  if (unused.length > 0) {
    items.push({ kind: "section", title: "Unused", count: unused.length });
    for (const row of unused) items.push({ kind: "volume", row });
  }
  return items;
}

export { rangeIds, toggleId };
