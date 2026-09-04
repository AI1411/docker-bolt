import { expect, test } from "vitest";
import { filterByQuery, matchesListQuery, noMatchCopy } from "./lib/listFilter";

test("empty query matches every row", () => {
  expect(matchesListQuery("", ["Redis"])).toBe(true);
  expect(matchesListQuery("   ", ["Redis"])).toBe(true);
});

test("substring match is case-insensitive on any field", () => {
  expect(matchesListQuery("red", ["api", "redis:7"])).toBe(true);
  expect(matchesListQuery("API", ["api"])).toBe(true);
  expect(matchesListQuery("nope", ["api", "nginx"])).toBe(false);
});

test("filterByQuery keeps matching rows", () => {
  const rows = [
    { name: "api", image: "nginx" },
    { name: "cache", image: "redis:7" },
  ];
  expect(filterByQuery(rows, "redis", (row) => [row.name, row.image]).map((row) => row.name)).toEqual([
    "cache",
  ]);
});

test("no-match copy only when a query hides every row", () => {
  expect(noMatchCopy("containers", "x", 3, 0)).toBe("No containers match");
  expect(noMatchCopy("containers", "", 0, 0)).toBeNull();
  expect(noMatchCopy("containers", "x", 0, 0)).toBeNull();
});
