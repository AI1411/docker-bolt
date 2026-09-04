import { create } from "zustand";
import { api, ipcErrorMessage, type NetworkRow } from "../lib/tauri";

type NetworksState = {
  rows: NetworkRow[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  setRows: (rows: NetworkRow[]) => void;
  clear: () => void;
  select: (id: string | null) => void;
  removeRow: (id: string) => void;
  reload: () => Promise<void>;
};

export const useNetworks = create<NetworksState>((set, get) => ({
  rows: [],
  loading: false,
  error: null,
  selectedId: null,
  setRows: (rows) => {
    const selectedId = get().selectedId;
    set({
      rows,
      loading: false,
      error: null,
      selectedId: selectedId && rows.some((row) => row.id === selectedId) ? selectedId : null,
    });
  },
  clear: () => set({ rows: [], loading: false, error: null, selectedId: null }),
  select: (id) => set({ selectedId: id }),
  removeRow: (id) =>
    set((state) => ({
      rows: state.rows.filter((row) => row.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),
  reload: async () => {
    set({ loading: true, error: null });
    try {
      const rows = await api.listNetworks();
      get().setRows(rows);
    } catch (err) {
      set({ loading: false, error: ipcErrorMessage(err) });
    }
  },
}));
