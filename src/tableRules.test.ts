/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "vitest";

const css = readFileSync(resolve("src/styles.css"), "utf8");

test("data rows do not draw a hairline under every row", () => {
  const rowBlock = css.match(/\.row \{[^}]+\}/)?.[0] ?? "";
  expect(rowBlock).not.toMatch(/border-bottom/);
});

test("section rows keep a hairline boundary", () => {
  expect(css).toMatch(/\.row\.section \{[^}]*border-bottom:\s*1px solid var\(--border\)/);
});
