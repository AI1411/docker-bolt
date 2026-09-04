import { expect, test } from "vitest";
import { connectionPill, resourceStatusPill } from "./lib/statusPill";

test("running maps to an ok pill with a label", () => {
  expect(resourceStatusPill("running", true)).toEqual({ label: "Running", tone: "ok" });
  expect(resourceStatusPill("exited", false)).toEqual({ label: "Exited", tone: "neutral" });
  expect(resourceStatusPill("created")).toEqual({ label: "Created", tone: "neutral" });
});

test("connection pills are labeled, not color-only", () => {
  expect(connectionPill("connecting")).toEqual({ label: "Connecting", tone: "warn" });
  expect(connectionPill("disconnected")).toEqual({ label: "Disconnected", tone: "warn" });
  expect(connectionPill("connected")).toEqual({ label: "Connected", tone: "ok" });
});
