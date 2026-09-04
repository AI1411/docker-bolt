import { expect, test } from "vitest";
import { isSystemNetwork } from "./lib/networks";

test("default Docker networks cannot be deleted", () => {
  expect(isSystemNetwork("bridge")).toBe(true);
  expect(isSystemNetwork("host")).toBe(true);
  expect(isSystemNetwork("none")).toBe(true);
  expect(isSystemNetwork("frontend")).toBe(false);
});
