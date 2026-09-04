import { create } from "zustand";
import { shouldReuseInspect } from "../lib/inspect";
import { api, ipcErrorMessage, type ContainerInspect } from "../lib/tauri";

type InspectState = {
  generation: number;
  byId: Record<string, { generation: number; data: ContainerInspect }>;
  loadingId: string | null;
  error: string | null;
  showValues: boolean;
  setShowValues: (show: boolean) => void;
  invalidate: () => void;
  clear: () => void;
  load: (id: string) => Promise<void>;
};

export const useInspect = create<InspectState>((set, get) => ({
  generation: 0,
  byId: {},
  loadingId: null,
  error: null,
  showValues: false,
  setShowValues: (showValues) => set({ showValues }),
  invalidate: () =>
    set((state) => ({
      generation: state.generation + 1,
      byId: {},
      error: null,
    })),
  clear: () => set({ generation: 0, byId: {}, loadingId: null, error: null, showValues: false }),
  load: async (id) => {
    const { byId, generation } = get();
    const cached = byId[id];
    if (cached && shouldReuseInspect(cached.generation, generation)) {
      set({ error: null, loadingId: null });
      return;
    }
    set({ loadingId: id, error: null });
    try {
      const data = await api.inspectContainer(id);
      if (get().loadingId !== id) return;
      set((state) => ({
        loadingId: null,
        error: null,
        byId: {
          ...state.byId,
          [id]: { generation: state.generation, data },
        },
      }));
    } catch (err) {
      if (get().loadingId !== id) return;
      set({ loadingId: null, error: ipcErrorMessage(err) });
      throw err;
    }
  },
}));
