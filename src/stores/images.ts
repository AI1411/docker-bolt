import { create } from "zustand";
import { api, ipcErrorMessage, type ImageRow } from "../lib/tauri";

type ImagesState = {
  rows: ImageRow[];
  loading: boolean;
  error: string | null;
  selectedIds: string[];
  setRows: (rows: ImageRow[]) => void;
  clear: () => void;
  setSelectedIds: (ids: string[]) => void;
  select: (id: string | null) => void;
  removeRow: (id: string) => void;
  removeRows: (ids: string[]) => void;
  reload: () => Promise<void>;
};

function keepSelected(rows: ImageRow[], selectedIds: string[]): string[] {
  const present = new Set(rows.map((row) => row.id));
  return selectedIds.filter((id) => present.has(id));
}

export const useImages = create<ImagesState>((set, get) => ({
  rows: [],
  loading: false,
  error: null,
  selectedIds: [],
  setRows: (rows) => {
    set({
      rows,
      loading: false,
      error: null,
      selectedIds: keepSelected(rows, get().selectedIds),
    });
  },
  clear: () => set({ rows: [], loading: false, error: null, selectedIds: [] }),
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  select: (id) => set({ selectedIds: id ? [id] : [] }),
  removeRow: (id) => get().removeRows([id]),
  removeRows: (ids) => {
    const drop = new Set(ids);
    set((state) => ({
      rows: state.rows.filter((row) => !drop.has(row.id)),
      selectedIds: state.selectedIds.filter((id) => !drop.has(id)),
    }));
  },
  reload: async () => {
    set({ loading: true, error: null });
    try {
      const rows = await api.listImages();
      get().setRows(rows);
    } catch (err) {
      set({ loading: false, error: ipcErrorMessage(err) });
    }
  },
}));
