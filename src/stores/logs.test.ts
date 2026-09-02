import { expect, test } from "vitest";
import { applyBatch } from "./logs";
import type { LogLine } from "../lib/tauri";

test("drops oldest past 20000", () => {
  const current: LogLine[] = Array.from({ length: 19998 }, (_, i) => ({
    seq: i,
    stream: "stdout" as const,
    raw: "x",
  }));
  const incoming: LogLine[] = [
    { seq: 19998, stream: "stdout", raw: "a" },
    { seq: 19999, stream: "stdout", raw: "b" },
    { seq: 20000, stream: "stdout", raw: "c" },
  ];
  const out = applyBatch(current, incoming, 20000);
  expect(out).toHaveLength(20000);
  expect(out[0].seq).toBe(1);
  expect(out[out.length - 1].seq).toBe(20000);
});
