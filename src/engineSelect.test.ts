import { expect, test } from "vitest";
import { nextEngineId } from "./lib/engineSelect";

const orbstack = { engine_id: "orbstack", available: true };
const unixLive = { engine_id: "unix-default", available: true };
const unixDead = { engine_id: "unix-default", available: false };
const orbstackDown = { engine_id: "orbstack", available: false };

test("prefer saved if available", () => {
  expect(nextEngineId("unix-default", [orbstack, unixLive])).toBe("unix-default");
});

test("skip dead saved and use priority", () => {
  expect(nextEngineId("unix-default", [orbstack, unixDead])).toBe("orbstack");
});

test("none when all down", () => {
  expect(nextEngineId(undefined, [orbstackDown])).toBeUndefined();
});
