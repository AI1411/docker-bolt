import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ListSearch } from "../components/ListSearch";
import { ResourceTile } from "../components/icons";
import { StatusPill } from "../components/StatusPill";
import { buttonClass } from "../lib/buttonClass";
import { composeUpCancelled } from "../lib/composeUp";
import { filterByQuery, noMatchCopy } from "../lib/listFilter";
import { listRowA11y } from "../lib/listKeys";
import { resourceStatusPill } from "../lib/statusPill";
import { useListKeyboard } from "../lib/useListKeyboard";
import { VirtualTable, type VirtualTableHandle } from "../components/VirtualTable";
import { api, ipcErrorMessage } from "../lib/tauri";
import { useCompose } from "../stores/compose";
import { useConnection } from "../stores/connection";

type Dialog =
  | { kind: "down"; project: string; body: string }
  | { kind: "error"; body: string };

export function Compose() {
  const view = useConnection((s) => s.view);
  const retry = useConnection((s) => s.retry);
  const rows = useCompose((s) => s.rows);
  const loading = useCompose((s) => s.loading);
  const error = useCompose((s) => s.error);
  const selectedProject = useCompose((s) => s.selectedProject);
  const select = useCompose((s) => s.select);
  const reload = useCompose((s) => s.reload);
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => filterByQuery(rows, query, (row) => [row.project, row.status]),
    [rows, query],
  );
  const selected = visible.find((row) => row.project === selectedProject) ?? null;
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<VirtualTableHandle>(null);

  useListKeyboard({
    ids: visible.map((row) => row.project),
    selectedId: selectedProject,
    onSelect: select,
    searchRef,
    tableRef,
    dialogOpen: Boolean(dialog),
    onDelete: () => {
      const row = useCompose.getState().rows.find((item) => item.project === useCompose.getState().selectedProject);
      if (!row || busy) return;
      setDialog({
        kind: "down",
        project: row.project,
        body: `${row.project} will remove ${row.container_count} container(s) and project networks. Named volumes are kept. You cannot start this project again from DockBolt.`,
      });
    },
  });

  async function onUp() {
    if (!connected || busy) return;
    setBusy(true);
    try {
      const picked = await api.pickComposeFile();
      if (composeUpCancelled(picked.path)) return;
      await api.upComposeFile(picked.path);
      await reload();
    } catch (err) {
      setDialog({ kind: "error", body: ipcErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(command: (project: string) => Promise<unknown>, project: string) {
    setBusy(true);
    try {
      await command(project);
      setDialog(null);
    } catch (err) {
      setDialog({ kind: "error", body: ipcErrorMessage(err) });
    } finally {
      await reload();
      setBusy(false);
    }
  }

  function body() {
    if (view.status === "connecting") {
      return (
        <div className="empty">
          <p>Looking for a Docker engine…</p>
          <p>Compose projects show up here once an engine connects.</p>
        </div>
      );
    }
    if (view.status === "disconnected") {
      return (
        <div className="empty">
          <p>{view.message}</p>
          <button type="button" className={buttonClass("primary")} onClick={() => void retry()}>
            Retry
          </button>
        </div>
      );
    }
    if (error) {
      return <div className="empty">{error}</div>;
    }
    if (!loading && connected && rows.length === 0) {
      return <div className="empty">No compose projects</div>;
    }
    const miss = noMatchCopy("compose projects", query, rows.length, visible.length);
    if (miss) {
      return <div className="empty">{miss}</div>;
    }
    return (
      <VirtualTable
        ref={tableRef}
        count={visible.length}
        rowHeight={56}
        rowRenderer={(index) => {
          const row = visible[index];
          return (
            <div
              className={`row list-row ${row.project === selectedProject ? "selected" : ""}`}
              data-cols="compose"
              {...listRowA11y(row.project === selectedProject)}
              onClick={() => select(row.project)}
            >
              <ResourceTile kind="compose" running={row.status === "running"} />
              <span className="cell-stack">
                <span className="cell-primary" title={row.project}>
                  {row.project}
                </span>
                <span className="cell-secondary">
                  {row.service_count} services · {row.running_count}/{row.container_count} containers
                </span>
              </span>
              <span className="cell">
                <StatusPill {...resourceStatusPill(row.status, row.status === "running")} />
              </span>
            </div>
          );
        }}
      />
    );
  }

  const commandDisabled = !connected || !selected || busy;

  return (
    <div className="screen">
      <div className="toolbar">
        <span className="toolbar-title">Compose</span>
        <ListSearch ref={searchRef} value={query} onChange={setQuery} label="Filter compose projects" />
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!connected || loading}
          onClick={() => void reload()}
        >
          Refresh
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!connected || busy}
          onClick={() => void onUp()}
        >
          Up…
        </button>
        <button
          type="button"
          className={buttonClass("primary")}
          disabled={commandDisabled}
          onClick={() => selected && void runCommand(api.startComposeProject, selected.project)}
        >
          Start
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={commandDisabled}
          onClick={() => selected && void runCommand(api.stopComposeProject, selected.project)}
        >
          Stop
        </button>
        <button
          type="button"
          className={buttonClass("danger")}
          disabled={commandDisabled}
          onClick={() => {
            if (!selected || busy) return;
            setDialog({
              kind: "down",
              project: selected.project,
              body: `${selected.project} will remove ${selected.container_count} container(s) and project networks. Named volumes are kept. You cannot start this project again from DockBolt.`,
            });
          }}
        >
          Down
        </button>
      </div>
      {body()}
      {dialog?.kind === "down" ? (
        <ConfirmDialog
          title="Down compose project"
          body={dialog.body}
          confirmLabel="Down"
          confirmVariant="danger"
          confirmDisabled={busy}
          onCancel={() => {
            if (!busy) setDialog(null);
          }}
          onConfirm={() => void runCommand(api.downComposeProject, dialog.project)}
        />
      ) : null}
      {dialog?.kind === "error" ? (
        <ConfirmDialog
          title="Error"
          body={dialog.body}
          confirmLabel="OK"
          showCancel={false}
          onCancel={() => setDialog(null)}
          onConfirm={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
