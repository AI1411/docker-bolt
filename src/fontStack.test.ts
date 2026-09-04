/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { readFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);

const css = readFileSync(resolve("src/styles.css"), "utf8");
const main = readFileSync(resolve("src/main.tsx"), "utf8");

test("app ships IBM Plex Sans as the first UI face", () => {
  expect(css).toMatch(/--font-text:\s*"IBM Plex Sans"/);
  expect(css).toMatch(/--font-mono:\s*"IBM Plex Mono"/);
});

test("html does not keep Apple marketing letter-spacing on the shipped face", () => {
  const htmlBlock = css.match(/html \{[^}]+\}/)?.[0] ?? "";
  expect(htmlBlock).toMatch(/letter-spacing:\s*normal/);
  expect(htmlBlock).not.toMatch(/-0\.357px/);
});

test("main imports bundled Plex files", () => {
  expect(main).toMatch(/@fontsource\/ibm-plex-sans/);
  expect(main).toMatch(/@fontsource\/ibm-plex-mono/);
});

test("bundled Plex CSS files resolve from node_modules", () => {
  const files = [
    "@fontsource/ibm-plex-sans/400.css",
    "@fontsource/ibm-plex-sans/600.css",
    "@fontsource/ibm-plex-mono/400.css",
  ];
  for (const file of files) {
    expect(require.resolve(file), file).toMatch(/node_modules/);
  }
});
