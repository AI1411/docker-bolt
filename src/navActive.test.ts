import { expect, test } from "vitest";
import { containersNavActive, navCount } from "./lib/navActive";

test("Containers stays active on the logs route", () => {
  expect(containersNavActive("/")).toBe(true);
  expect(containersNavActive("/containers/abc/logs")).toBe(true);
  expect(containersNavActive("/compose")).toBe(false);
  expect(containersNavActive("/images")).toBe(false);
});

test("nav counts hide until connected and loaded", () => {
  expect(navCount(false, false, 3)).toBeNull();
  expect(navCount(true, true, 3)).toBeNull();
  expect(navCount(true, false, 3)).toBe(3);
});
