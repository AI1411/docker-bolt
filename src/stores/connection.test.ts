import { afterEach, expect, test, vi } from "vitest";
import {
  api,
  shouldApplyConnectionSnapshot,
  type ConnectionView,
} from "../lib/tauri";
import { useCompose } from "./compose";
import { useConnection } from "./connection";

const connected: ConnectionView = {
  status: "connected",
  engine_id: "orbstack",
  name: "OrbStack",
  endpoint: "unix:///tmp/docker.sock",
  api_version: "1.44",
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("entering connected reloads compose outside the refresh all payload", () => {
  useConnection.setState({ view: { status: "connecting" } });
  const refresh = vi
    .spyOn(api, "refresh")
    .mockResolvedValue({ containers: [], images: [], volumes: [] });
  const reloadCompose = vi
    .spyOn(useCompose.getState(), "reload")
    .mockResolvedValue();

  useConnection.getState().setView(connected);

  expect(refresh).toHaveBeenCalledWith("all");
  expect(reloadCompose).toHaveBeenCalledOnce();
});

test("disconnecting clears compose state", () => {
  useConnection.setState({ view: connected });
  const clearCompose = vi.spyOn(useCompose.getState(), "clear");

  useConnection.getState().setView({
    status: "disconnected",
    reason: "engine_unreachable",
    message: "events failed",
  });

  expect(clearCompose).toHaveBeenCalledOnce();
});

test("stale connecting snapshot does not overwrite connected", () => {
  expect(
    shouldApplyConnectionSnapshot(connected, { status: "connecting" }),
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
