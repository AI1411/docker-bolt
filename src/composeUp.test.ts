import { expect, test } from "vitest";
import { composeUpCancelled } from "./lib/composeUp";

test("cancelled file picker is a no-op", () => {
  expect(composeUpCancelled(null)).toBe(true);
  expect(composeUpCancelled(undefined)).toBe(true);
  expect(composeUpCancelled("")).toBe(true);
  expect(composeUpCancelled("/tmp/compose.yml")).toBe(false);
});
