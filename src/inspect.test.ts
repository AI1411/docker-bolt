import { expect, test } from "vitest";
import {
  closeInspectOnEscape,
  envValueDisplay,
  isTypingTarget,
  listOrDash,
  mountLabel,
  shouldReuseInspect,
} from "./lib/inspect";

test("env values stay hidden until show-values is on", () => {
  expect(envValueDisplay("secret", false)).toBe("••••");
  expect(envValueDisplay("secret", true)).toBe("secret");
  expect(envValueDisplay("", false)).toBe("");
});

test("inspect cache is reused only for the same generation", () => {
  expect(shouldReuseInspect(1, 1)).toBe(true);
  expect(shouldReuseInspect(1, 2)).toBe(false);
  expect(shouldReuseInspect(undefined, 0)).toBe(false);
});

test("mounts render source to destination", () => {
  expect(mountLabel({ source: "/data", destination: "/var/lib" })).toBe("/data → /var/lib");
  expect(listOrDash([])).toBe("—");
  expect(listOrDash(["bridge"])).toBe("bridge");
});

test("Escape closes inspect unless a dialog or field is active", () => {
  expect(closeInspectOnEscape("Escape", false, false)).toBe(true);
  expect(closeInspectOnEscape("Escape", true, false)).toBe(false);
  expect(closeInspectOnEscape("Escape", false, true)).toBe(false);
  expect(closeInspectOnEscape("Enter", false, false)).toBe(false);
});

test("inputs count as typing targets for Escape", () => {
  const input = document.createElement("input");
  expect(isTypingTarget(input)).toBe(true);
  expect(isTypingTarget(document.createElement("div"))).toBe(false);
});
