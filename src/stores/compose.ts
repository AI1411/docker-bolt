import { create } from "zustand";
import { api, ipcErrorMessage, type ComposeProjectRow } from "../lib/tauri";

type ComposeState = {
  rows: ComposeProjectRow[];
  loading: boolean;
  error: string | null;
  selectedProject: string | null;
  setRows: (rows: ComposeProjectRow[]) => void;
  clear: () => void;
  select: (project: string | null) => void;
  reload: () => Promise<void>;
};

export const useCompose = create<ComposeState>((set, get) => {
  let reloadGeneration = 0;

  return {
    rows: [],
    loading: false,
    error: null,
    selectedProject: null,
    setRows: (rows) => {
      const selectedProject = get().selectedProject;
      set({
        rows,
        loading: false,
        error: null,
        selectedProject:
          selectedProject && rows.some((row) => row.project === selectedProject)
            ? selectedProject
            : null,
      });
    },
    clear: () => {
      reloadGeneration += 1;
      set({ rows: [], loading: false, error: null, selectedProject: null });
    },
    select: (project) => set({ selectedProject: project }),
    reload: async () => {
      const generation = ++reloadGeneration;
      set({ loading: true, error: null });
      try {
        const rows = await api.listComposeProjects();
        if (generation === reloadGeneration) get().setRows(rows);
      } catch (err) {
        if (generation === reloadGeneration) {
          set({ loading: false, error: ipcErrorMessage(err) });
        }
      }
    },
  };
});
