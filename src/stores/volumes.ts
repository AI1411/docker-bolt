import { create } from "zustand";
import { api, ipcErrorMessage, type VolumeRow } from "../lib/tauri";

type VolumesState = {
  rows: VolumeRow[];
  loading: boolean;
  error: string | null;
  selectedNames: string[];
  setRows: (rows: VolumeRow[]) => void;
  clear: () => void;
  setSelectedNames: (names: string[]) => void;
  select: (name: string | null) => void;
  removeRow: (name: string) => void;
  removeRows: (names: string[]) => void;
  reload: () => Promise<void>;
};

function keepSelected(rows: VolumeRow[], selectedNames: string[]): string[] {
  const present = new Set(rows.map((row) => row.name));
  return selectedNames.filter((name) => present.has(name));
}

export const useVolumes = create<VolumesState>((set, get) => ({
  rows: [],
  loading: false,
  error: null,
  selectedNames: [],
  setRows: (rows) => {
    set({
      rows,
      loading: false,
      error: null,
      selectedNames: keepSelected(rows, get().selectedNames),
    });
  },
  clear: () => set({ rows: [], loading: false, error: null, selectedNames: [] }),
  setSelectedNames: (names) => set({ selectedNames: names }),
  select: (name) => set({ selectedNames: name ? [name] : [] }),
  removeRow: (name) => get().removeRows([name]),
  removeRows: (names) => {
    const drop = new Set(names);
    set((state) => ({
      rows: state.rows.filter((row) => !drop.has(row.name)),
      selectedNames: state.selectedNames.filter((name) => !drop.has(name)),
    }));
  },
  reload: async () => {
    set({ loading: true, error: null });
    try {
      const rows = await api.listVolumes();
      get().setRows(rows);
    } catch (err) {
      set({ loading: false, error: ipcErrorMessage(err) });
    }
  },
}));
