import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { VirtualTable } from "../components/VirtualTable";
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
  const selected = rows.find((row) => row.project === selectedProject) ?? null;
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (view.status === "disconnected") {
      return (
        <div className="empty">
          <p>{view.message}</p>
          <button type="button" onClick={() => void retry()}>
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
    return (
      <VirtualTable
        count={rows.length}
        rowHeight={32}
        header={
          <div className="row head" data-cols="compose">
            <span className="cell">Name</span>
            <span className="cell">Status</span>
            <span className="cell">Services</span>
            <span className="cell">Containers</span>
          </div>
        }
        rowRenderer={(index) => {
          const row = rows[index];
          return (
            <div
              className={`row ${row.project === selectedProject ? "selected" : ""}`}
              data-cols="compose"
              onClick={() => select(row.project)}
            >
              <span className="cell" title={row.project}>
                {row.project}
              </span>
              <span className="cell">{row.status}</span>
              <span className="cell">{row.service_count}</span>
              <span className="cell">
                {row.running_count}/{row.container_count}
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
        <button type="button" disabled={!connected || loading} onClick={() => void reload()}>
          Refresh
        </button>
        <button
          type="button"
          disabled={commandDisabled}
          onClick={() => selected && void runCommand(api.startComposeProject, selected.project)}
        >
          Start
        </button>
        <button
          type="button"
          disabled={commandDisabled}
          onClick={() => selected && void runCommand(api.stopComposeProject, selected.project)}
        >
          Stop
        </button>
        <button
          type="button"
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
