import { expect, test } from "vitest";
import { buildImageTableItems } from "./lib/imageGroups";
import type { ImageRow } from "./lib/tauri";

function row(id: string, in_use: boolean): ImageRow {
  return { id, tags: [id], size_bytes: 1, created_unix: 0, in_use };
}

test("groups in-use then unused with section headers", () => {
  const items = buildImageTableItems([row("unused", false), row("used", true)]);
  expect(items).toEqual([
    { kind: "section", title: "In use", count: 1 },
    { kind: "image", row: row("used", true) },
    { kind: "section", title: "Unused", count: 1 },
    { kind: "image", row: row("unused", false) },
  ]);
});

test("omits empty sections", () => {
  const items = buildImageTableItems([row("a", false)]);
  expect(items.map((i) => i.kind)).toEqual(["section", "image"]);
  expect(items[0]).toMatchObject({ title: "Unused", count: 1 });
});
