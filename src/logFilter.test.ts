import { expect, test } from "vitest";
import { filterLines } from "./lib/logFilter";
import type { LogLine } from "./lib/tauri";

const lines: LogLine[] = [
  { seq: 1, stream: "stdout", raw: "Hello World" },
  { seq: 2, stream: "stderr", raw: "boom" },
];

test("case insensitive substring", () => {
  expect(filterLines(lines, "hello", "all").map((l) => l.seq)).toEqual([1]);
});

test("stdout filter hides stderr", () => {
  expect(filterLines(lines, "", "stdout").map((l) => l.seq)).toEqual([1]);
});

test("empty query keeps all for all streams", () => {
  expect(filterLines(lines, "", "all")).toHaveLength(2);
});
