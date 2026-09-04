import { expect, test } from "vitest";
import {
  canRestartContainer,
  canStartContainer,
  canStopContainer,
} from "./lib/containerLifecycle";
import type { ContainerRow } from "./lib/tauri";

const running: ContainerRow = {
  id: "a",
  name: "api",
  image: "img",
  state: "running",
  running: true,
  created_unix: 1,
};
const stopped: ContainerRow = { ...running, running: false, state: "exited" };

test("start only when selected, connected, idle, and not running", () => {
  expect(canStartContainer(stopped, true, false)).toBe(true);
  expect(canStartContainer(running, true, false)).toBe(false);
  expect(canStartContainer(stopped, false, false)).toBe(false);
  expect(canStartContainer(stopped, true, true)).toBe(false);
  expect(canStartContainer(null, true, false)).toBe(false);
});

test("stop only when running", () => {
  expect(canStopContainer(running, true, false)).toBe(true);
  expect(canStopContainer(stopped, true, false)).toBe(false);
});

test("restart when any container is selected", () => {
  expect(canRestartContainer(running, true, false)).toBe(true);
  expect(canRestartContainer(stopped, true, false)).toBe(true);
  expect(canRestartContainer(null, true, false)).toBe(false);
});
