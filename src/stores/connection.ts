import { create } from "zustand";
import { nextEngineId } from "../lib/engineSelect";
import {
  api,
  ipcErrorCode,
  ipcErrorMessage,
  type ConnectionView,
  type EngineCandidate,
  type RefreshAll,
} from "../lib/tauri";
import { useContainers } from "./containers";
import { useImages } from "./images";
import { useLogs } from "./logs";
import { useVolumes } from "./volumes";

type ConnectionState = {
  view: ConnectionView;
  engines: EngineCandidate[];
  setView: (view: ConnectionView) => void;
  loadEngines: () => Promise<EngineCandidate[]>;
  connect: (engine_id: string) => Promise<void>;
  retry: () => Promise<void>;
  bootstrap: () => Promise<void>;
};

function clearLists() {
  useContainers.getState().clear();
  useImages.getState().clear();
  useVolumes.getState().clear();
  useLogs.getState().reset();
}

function applyRefreshAll(data: RefreshAll) {
  useContainers.getState().setRows(data.containers);
  useImages.getState().setRows(data.images);
  useVolumes.getState().setRows(data.volumes);
}

async function reloadAll() {
  const data = (await api.refresh("all")) as RefreshAll;
  applyRefreshAll(data);
}

export const useConnection = create<ConnectionState>((set, get) => ({
  view: { status: "connecting" },
  engines: [],
  setView: (view) => {
    const prev = get().view;
    set({ view });
    if (view.status === "disconnected") {
      clearLists();
    } else if (view.status === "connected" && prev.status !== "connected") {
      void reloadAll().catch(() => {
        void useContainers.getState().reload();
        void useImages.getState().reload();
        void useVolumes.getState().reload();
      });
    }
  },
  loadEngines: async () => {
    const engines = await api.listEngines();
    set({ engines });
    return engines;
  },
  connect: async (engine_id) => {
    clearLists();
    set({ view: { status: "connecting" } });
    try {
      const view = await api.connectEngine(engine_id);
      get().setView(view);
    } catch (err) {
      get().setView({
        status: "disconnected",
        reason: ipcErrorCode(err) ?? "internal",
        message: ipcErrorMessage(err),
      });
    }
  },
  retry: async () => {
    const engines = await get().loadEngines();
    const engine_id = nextEngineId(undefined, engines);
    if (engine_id) {
      await get().connect(engine_id);
    }
  },
  bootstrap: async () => {
    const view = await api.connectionStatus().catch(
      (): ConnectionView => ({
        status: "disconnected",
        reason: "internal",
        message: ipcErrorMessage("Request failed"),
      }),
    );
    const engines = await api.listEngines().catch((): EngineCandidate[] => []);
    set({ view, engines });
    if (view.status === "connected") {
      try {
        await reloadAll();
      } catch {
        await Promise.all([
          useContainers.getState().reload(),
          useImages.getState().reload(),
          useVolumes.getState().reload(),
        ]);
      }
    }
  },
}));
