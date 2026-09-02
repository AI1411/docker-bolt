import { expect, test } from "vitest";
import {
  shouldApplyConnectionSnapshot,
  type ConnectionView,
} from "../lib/tauri";

test("stale connecting snapshot does not overwrite connected", () => {
  const current: ConnectionView = {
    status: "connected",
    engine_id: "orbstack",
    name: "OrbStack",
    endpoint: "unix:///tmp/docker.sock",
    api_version: "1.44",
  };
  expect(
    shouldApplyConnectionSnapshot(current, { status: "connecting" }),
  ).toBe(false);
});

test("stale connecting snapshot does not overwrite disconnected", () => {
  const current: ConnectionView = {
    status: "disconnected",
    reason: "engine_unreachable",
    message: "events failed",
  };
  expect(
    shouldApplyConnectionSnapshot(current, { status: "connecting" }),
  ).toBe(false);
});

test("connected snapshot applies over connecting", () => {
  expect(
    shouldApplyConnectionSnapshot({ status: "connecting" }, {
      status: "connected",
      engine_id: "unix-default",
      name: "Docker",
      endpoint: "unix:///var/run/docker.sock",
      api_version: "1.44",
    }),
  ).toBe(true);
});
