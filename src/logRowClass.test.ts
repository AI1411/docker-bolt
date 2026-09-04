import { expect, test } from "vitest";
import { logRowClass } from "./lib/logRowClass";

test("stderr rows get a dedicated class, not the accent link color role", () => {
  expect(logRowClass("stderr")).toBe("row log-row stderr");
  expect(logRowClass("stdout")).toBe("row log-row");
});
