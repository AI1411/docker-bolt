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

async function dropListeners() {
  const batch = unlistenBatch;
  const ended = unlistenEnded;
  unlistenBatch = undefined;
  unlistenEnded = undefined;
  batch?.();
  ended?.();
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
    unlistenBatch = await listenLogsBatch((batch) => {
      if (!armed) {
        queuedBatches.push(batch);
        return;
      }
      if (batch.session_id !== get().sessionId) return;
      get().pushBatch(batch.lines, batch.omitted);
    });
    unlistenEnded = await listenLogsEnded((ended) => {
      if (!armed) {
        queuedEnded.push(ended);
        return;
      }
      if (ended.session_id !== get().sessionId) return;
      set({ endedReason: ended.reason });
    });
    try {
      const { session_id } = await api.startLogs(containerId);
      set({ sessionId: session_id });
      armed = true;
      for (const batch of queuedBatches) {
        if (batch.session_id === session_id) {
          get().pushBatch(batch.lines, batch.omitted);
        }
      }
      for (const ended of queuedEnded) {
        if (ended.session_id === session_id) {
          set({ endedReason: ended.reason });
        }
      }
    } catch (err) {
      await dropListeners();
      set({
        error: ipcErrorMessage(err),
        endedReason: ipcErrorCode(err) === "not_found" ? "container_gone" : "error",
      });
    }
  },
  stop: async () => {
    const sessionId = get().sessionId;
    await dropListeners();
    if (sessionId) {
      try {
        await api.stopLogs(sessionId);
      } catch {
        // Leaving the screen should not surface stop errors.
      }
    }
    set({ sessionId: null });
  },
}));
