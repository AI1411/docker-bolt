import { create } from "zustand";
import { api, ipcErrorMessage, type VolumeRow } from "../lib/tauri";

type VolumesState = {
  rows: VolumeRow[];
  loading: boolean;
  error: string | null;
  selectedName: string | null;
  setRows: (rows: VolumeRow[]) => void;
  clear: () => void;
  select: (name: string | null) => void;
  removeRow: (name: string) => void;
  reload: () => Promise<void>;
};

export const useVolumes = create<VolumesState>((set, get) => ({
  rows: [],
  loading: false,
  error: null,
  selectedName: null,
  setRows: (rows) => {
    const selectedName = get().selectedName;
    set({
      rows,
      loading: false,
      error: null,
      selectedName:
        selectedName && rows.some((row) => row.name === selectedName) ? selectedName : null,
    });
  },
  clear: () => set({ rows: [], loading: false, error: null, selectedName: null }),
  select: (name) => set({ selectedName: name }),
  removeRow: (name) =>
    set((state) => ({
      rows: state.rows.filter((row) => row.name !== name),
      selectedName: state.selectedName === name ? null : state.selectedName,
    })),
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
