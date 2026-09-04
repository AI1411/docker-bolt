import { expect, test } from "vitest";
import {
  COPY_CONFIRM_THRESHOLD,
  copyNeedsConfirm,
  filterLines,
  formatFilteredLogsCopy,
} from "./lib/logFilter";
import type { LogLine } from "./lib/tauri";

const lines: LogLine[] = [
  { seq: 1, stream: "stdout", raw: "Hello World", timestamp_unix_ms: Date.UTC(2024, 0, 2, 3, 4, 5) },
  { seq: 2, stream: "stderr", raw: "boom" },
];

test("case insensitive substring", () => {
  expect(filterLines(lines, "hello", "all").lines.map((l) => l.seq)).toEqual([1]);
  expect(filterLines(lines, "hello", "all").invalidRegex).toBe(false);
});

test("stdout filter hides stderr", () => {
  expect(filterLines(lines, "", "stdout").lines.map((l) => l.seq)).toEqual([1]);
});

test("empty query keeps all for all streams", () => {
  expect(filterLines(lines, "", "all").lines).toHaveLength(2);
});

test("regex match", () => {
  expect(filterLines(lines, "H.*World", "all", true).lines.map((l) => l.seq)).toEqual([1]);
  expect(filterLines(lines, "H.*World", "all", true).invalidRegex).toBe(false);
});

test("invalid regex shows none and flags status", () => {
  const result = filterLines(lines, "[", "all", true);
  expect(result.lines).toEqual([]);
  expect(result.invalidRegex).toBe(true);
});

test("substring mode still matches a bracket query", () => {
  const withBracket: LogLine[] = [{ seq: 3, stream: "stdout", raw: "a[b" }];
  const result = filterLines(withBracket, "[", "all", false);
  expect(result.lines.map((l) => l.seq)).toEqual([3]);
  expect(result.invalidRegex).toBe(false);
});

test("copy text is timestamp plus raw for the filtered set", () => {
  const filtered = filterLines(lines, "hello", "all").lines;
  expect(formatFilteredLogsCopy(filtered)).toBe("2024-01-02T03:04:05.000Z Hello World");
});

test("copy confirms above the line cap", () => {
  expect(copyNeedsConfirm(COPY_CONFIRM_THRESHOLD)).toBe(false);
  expect(copyNeedsConfirm(COPY_CONFIRM_THRESHOLD + 1)).toBe(true);
});
