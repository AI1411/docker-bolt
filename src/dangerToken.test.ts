/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "vitest";

const css = readFileSync(resolve("src/styles.css"), "utf8");

test("danger token is a red that can carry white text, not near-black", () => {
  expect(css).toMatch(/--danger:\s*#c41e3a/);
  expect(css).not.toMatch(/--danger:\s*#1d1d1f/);
});

test("danger buttons fill with the danger token", () => {
  const block = css.match(/button\.danger \{[^}]+\}/)?.[0] ?? "";
  expect(block).toMatch(/background:\s*var\(--danger\)/);
  expect(block).toMatch(/color:\s*#fff/);
});
