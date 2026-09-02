import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { StreamFilter } from "../lib/logFilter";
import {
  api,
  ipcErrorCode,
  ipcErrorMessage,
  listenLogsBatch,
  listenLogsEnded,
  type LogEndedReason,
  type LogLine,
  type LogsBatch,
  type LogsEnded,
} from "../lib/tauri";

export function applyBatch(
  current: LogLine[],
  incoming: LogLine[],
  max = 20000,
): LogLine[] {
  const next = current.concat(incoming);
  return next.length > max ? next.slice(next.length - max) : next;
}

type LogsState = {
  sessionId: string | null;
  containerId: string | null;
  lines: LogLine[];
  query: string;
  streamFilter: StreamFilter;
  omitted: number;
  endedReason: LogEndedReason | null;
  error: string | null;
  setQuery: (query: string) => void;
  setStreamFilter: (streamFilter: StreamFilter) => void;
  clearFilters: () => void;
  pushBatch: (lines: LogLine[], omitted: number) => void;
  start: (containerId: string) => Promise<void>;
  stop: () => Promise<void>;
};

let unlistenBatch: UnlistenFn | undefined;
let unlistenEnded: UnlistenFn | undefined;
let startGeneration = 0;
let pendingStartLogs: Promise<string | null> | null = null;

async function dropListeners() {
  const batch = unlistenBatch;
  const ended = unlistenEnded;
  unlistenBatch = undefined;
  unlistenEnded = undefined;
  batch?.();
  ended?.();
}

async function stopSession(sessionId: string) {
  try {
    await api.stopLogs(sessionId);
  } catch {
    // Leaving the screen should not surface stop errors.
  }
}

export const useLogs = create<LogsState>((set, get) => ({
  sessionId: null,
  containerId: null,
  lines: [],
  query: "",
  streamFilter: "all",
  omitted: 0,
  endedReason: null,
  error: null,
  setQuery: (query) => set({ query }),
  setStreamFilter: (streamFilter) => set({ streamFilter }),
  clearFilters: () => set({ query: "", streamFilter: "all" }),
  pushBatch: (lines, omitted) =>
    set((state) => ({
      lines: applyBatch(state.lines, lines),
      omitted: state.omitted + omitted,
    })),
  start: async (containerId) => {
    await get().stop();
    const generation = ++startGeneration;
    set({
      containerId,
      sessionId: null,
      lines: [],
      omitted: 0,
      endedReason: null,
      error: null,
    });
    const queuedBatches: LogsBatch[] = [];
    const queuedEnded: LogsEnded[] = [];
    let armed = false;
    const batchUnlisten = await listenLogsBatch((batch) => {
      if (generation !== startGeneration) return;
      if (!armed) {
        queuedBatches.push(batch);
        return;
      }
      if (batch.session_id !== get().sessionId) return;
      get().pushBatch(batch.lines, batch.omitted);
    });
    if (generation !== startGeneration) {
      batchUnlisten();
      return;
    }
    unlistenBatch = batchUnlisten;
    const endedUnlisten = await listenLogsEnded((ended) => {
      if (generation !== startGeneration) return;
      if (!armed) {
        queuedEnded.push(ended);
        return;
      }
      if (ended.session_id !== get().sessionId) return;
      set({ endedReason: ended.reason });
    });
    if (generation !== startGeneration) {
      endedUnlisten();
      await dropListeners();
      return;
    }
    unlistenEnded = endedUnlisten;
    const startLogsPromise = api.startLogs(containerId).then((result) => result.session_id);
    const settled = startLogsPromise.then(
      (sessionId) => sessionId,
      () => null,
    );
    pendingStartLogs = settled;
    let sessionId: string;
    try {
      sessionId = await startLogsPromise;
    } catch (err) {
      if (pendingStartLogs === settled) pendingStartLogs = null;
      if (generation !== startGeneration) return;
      await dropListeners();
      set({
        error: ipcErrorMessage(err),
        endedReason: ipcErrorCode(err) === "not_found" ? "container_gone" : "error",
      });
      return;
    }
    if (generation !== startGeneration) {
      return;
    }
    if (pendingStartLogs === settled) pendingStartLogs = null;
    set({ sessionId });
    armed = true;
    for (const batch of queuedBatches) {
      if (batch.session_id === sessionId) {
        get().pushBatch(batch.lines, batch.omitted);
      }
    }
    for (const ended of queuedEnded) {
      if (ended.session_id === sessionId) {
        set({ endedReason: ended.reason });
      }
    }
  },
  stop: async () => {
    startGeneration += 1;
    const sessionId = get().sessionId;
    const pending = pendingStartLogs;
    pendingStartLogs = null;
    await dropListeners();
    const ids = new Set<string>();
    if (sessionId) ids.add(sessionId);
    if (pending) {
      const pendingId = await pending;
      if (pendingId) ids.add(pendingId);
    }
    for (const id of ids) {
      await stopSession(id);
    }
    set({ sessionId: null });
  },
}));
