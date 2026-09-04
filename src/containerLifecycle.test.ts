import { expect, test } from "vitest";
import {
  canRestartContainer,
  canStartComposeProject,
  canStartContainer,
  canStopComposeProject,
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

test("compose start is allowed unless every container is already running", () => {
  expect(canStartComposeProject("stopped", true, false)).toBe(true);
  expect(canStartComposeProject("partial", true, false)).toBe(true);
  expect(canStartComposeProject("running", true, false)).toBe(false);
  expect(canStartComposeProject("stopped", false, false)).toBe(false);
  expect(canStartComposeProject("stopped", true, true)).toBe(false);
});

test("compose stop is allowed when any container is running", () => {
  expect(canStopComposeProject("running", true, false)).toBe(true);
  expect(canStopComposeProject("partial", true, false)).toBe(true);
  expect(canStopComposeProject("stopped", true, false)).toBe(false);
});
