import { expect, test } from "vitest";
import { buildVolumeTableItems, unusedVolumeNames } from "./lib/volumeGroups";
import type { VolumeRow } from "./lib/tauri";

function row(name: string, in_use: boolean): VolumeRow {
  return { name, driver: "local", in_use };
}

test("groups in-use then unused volume sections", () => {
  const items = buildVolumeTableItems([row("tmp", false), row("data", true)]);
  expect(items).toEqual([
    { kind: "section", title: "In use", count: 1 },
    { kind: "volume", row: row("data", true) },
    { kind: "section", title: "Unused", count: 1 },
    { kind: "volume", row: row("tmp", false) },
  ]);
});

test("omits empty volume sections", () => {
  const items = buildVolumeTableItems([row("a", false)]);
  expect(items.map((item) => item.kind)).toEqual(["section", "volume"]);
  expect(items[0]).toMatchObject({ title: "Unused", count: 1 });
});

test("unusedVolumeNames skips in-use and empty names", () => {
  expect(unusedVolumeNames([row("u", false), row("i", true)])).toEqual(["u"]);
});
