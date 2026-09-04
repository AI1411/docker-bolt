import { expect, test } from "vitest";
import { connectionStatusClass, connectionTone, runDotClass } from "./lib/chromeTone";

test("connecting and disconnected use warn tone, not accent", () => {
  expect(connectionTone("connecting")).toBe("warn");
  expect(connectionTone("disconnected")).toBe("warn");
  expect(connectionTone("connected")).toBe("ok");
});

test("connection status class includes warn for connecting and disconnected", () => {
  expect(connectionStatusClass("connecting")).toContain("warn");
  expect(connectionStatusClass("disconnected")).toContain("warn");
  expect(connectionStatusClass("connected")).not.toContain("warn");
  expect(connectionStatusClass("connected")).toContain("ok");
});

test("running dot uses running class for ok color", () => {
  expect(runDotClass(true)).toBe("run-dot running");
  expect(runDotClass(false)).toBe("run-dot");
});
