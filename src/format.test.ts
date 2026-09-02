import { expect, test } from "vitest";
import { shortId } from "./lib/format";

test("short id strips sha and truncates", () => {
  expect(shortId("sha256:0123456789abcdef")).toBe("0123456789ab");
});
