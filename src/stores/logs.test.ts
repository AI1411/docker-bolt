import { afterEach, expect, test, vi } from "vitest";
import { applyBatch } from "./logs";
import type { LogLine } from "../lib/tauri";
import { isPinnedToBottom } from "../lib/scroll";

const startLogs = vi.fn<(container_id: string) => Promise<{ session_id: string }>>();
const stopLogs = vi.fn<(session_id: string) => Promise<void>>(async () => undefined);
const listenLogsBatch = vi.fn<(cb: (batch: unknown) => void) => Promise<() => void>>(
  async () => () => {},
);
const listenLogsEnded = vi.fn<(cb: (ended: unknown) => void) => Promise<() => void>>(
  async () => () => {},
);

vi.mock("../lib/tauri", () => ({
  api: {
    startLogs: (container_id: string) => startLogs(container_id),
    stopLogs: (session_id: string) => stopLogs(session_id),
  },
  listenLogsBatch: (cb: (batch: unknown) => void) => listenLogsBatch(cb),
  listenLogsEnded: (cb: (ended: unknown) => void) => listenLogsEnded(cb),
  ipcErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : "Request failed",
  ipcErrorCode: () => undefined,
}));

async function waitFor(assert: () => void) {
  const deadline = Date.now() + 1000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      assert();
      return;
    } catch (err) {
      last = err;
      await Promise.resolve();
    }
  }
  throw last;
}

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

test("is pinned to bottom near the latest lines", () => {
  expect(isPinnedToBottom(0, 1000, 200)).toBe(false);
  expect(isPinnedToBottom(800, 1000, 200)).toBe(true);
  expect(isPinnedToBottom(752, 1000, 200)).toBe(true);
  expect(isPinnedToBottom(700, 1000, 200)).toBe(false);
});

afterEach(async () => {
  const { useLogs } = await import("./logs");
  await useLogs.getState().stop();
  useLogs.setState({
    sessionId: null,
    containerId: null,
    lines: [],
    omitted: 0,
    endedReason: null,
    error: null,
    query: "",
    streamFilter: "all",
  });
  vi.clearAllMocks();
  stopLogs.mockResolvedValue(undefined);
});

test("stop during in-flight start_logs still calls stop_logs", async () => {
  const { useLogs } = await import("./logs");
  let resolveStart: (value: { session_id: string }) => void = () => {};
  startLogs.mockImplementation(
    () =>
      new Promise<{ session_id: string }>((resolve) => {
        resolveStart = resolve;
      }),
  );

  const started = useLogs.getState().start("ctr");
  await waitFor(() => expect(startLogs).toHaveBeenCalledTimes(1));
  const stopped = useLogs.getState().stop();
  resolveStart({ session_id: "sess-1" });
  await stopped;
  await started;

  expect(stopLogs).toHaveBeenCalledWith("sess-1");
  expect(useLogs.getState().sessionId).toBeNull();
});

test("superseded start does not commit sessionId", async () => {
  const { useLogs } = await import("./logs");
  const resolvers: Array<(value: { session_id: string }) => void> = [];
  startLogs.mockImplementation(
    () =>
      new Promise<{ session_id: string }>((resolve) => {
        resolvers.push(resolve);
      }),
  );

  const first = useLogs.getState().start("a");
  await waitFor(() => expect(startLogs).toHaveBeenCalledTimes(1));
  const second = useLogs.getState().start("b");
  await waitFor(() => expect(resolvers.length).toBeGreaterThanOrEqual(1));
  resolvers[0]({ session_id: "sess-a" });
  await waitFor(() => expect(stopLogs).toHaveBeenCalledWith("sess-a"));
  await waitFor(() => expect(startLogs).toHaveBeenCalledTimes(2));
  resolvers[1]({ session_id: "sess-b" });
  await first;
  await second;

  expect(useLogs.getState().sessionId).toBe("sess-b");
  expect(useLogs.getState().containerId).toBe("b");
});
