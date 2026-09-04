import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ResourceTile } from "../components/icons";
import { VirtualTable } from "../components/VirtualTable";
import { api, ipcErrorCode, ipcErrorMessage } from "../lib/tauri";
import { useConnection } from "../stores/connection";
import { useVolumes } from "../stores/volumes";

type Dialog =
  | { kind: "delete"; title: string; body: string; name: string }
  | { kind: "error"; body: string };

export function Volumes() {
  const view = useConnection((s) => s.view);
  const retry = useConnection((s) => s.retry);
  const rows = useVolumes((s) => s.rows);
  const loading = useVolumes((s) => s.loading);
  const error = useVolumes((s) => s.error);
  const selectedName = useVolumes((s) => s.selectedName);
  const select = useVolumes((s) => s.select);
  const reload = useVolumes((s) => s.reload);
  const removeRow = useVolumes((s) => s.removeRow);
  const selected = rows.find((row) => row.name === selectedName) ?? null;
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete(name: string) {
    setBusy(true);
    try {
      await api.deleteVolume(name);
      removeRow(name);
      setDialog(null);
    } catch (err) {
      if (ipcErrorCode(err) === "not_found") {
        await reload();
      }
      setDialog({ kind: "error", body: ipcErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function body() {
    if (view.status === "connecting") {
      return (
        <div className="empty">
          <p>Looking for a Docker engine…</p>
          <p>Volumes show up here once an engine connects.</p>
        </div>
      );
    }
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
      return <div className="empty">No volumes</div>;
    }
    return (
      <VirtualTable
        count={rows.length}
        rowHeight={56}
        rowRenderer={(index) => {
          const row = rows[index];
          return (
            <div
              className={`row list-row ${row.name === selectedName ? "selected" : ""}`}
              data-cols="volumes"
              onClick={() => select(row.name)}
            >
              <ResourceTile kind="volume" />
              <span className="cell-stack">
                <span className="cell-primary" title={row.name}>
                  {row.name}
                </span>
                <span className="cell-secondary">{row.driver}</span>
              </span>
            </div>
          );
        }}
      />
    );
  }

  return (
    <div className="screen">
      <div className="toolbar">
        <button type="button" disabled={!connected || loading} onClick={() => void reload()}>
          Refresh
        </button>
        <button
          type="button"
          disabled={!connected || !selected || busy}
          onClick={() => {
            if (!selected || busy) return;
            setDialog({
              kind: "delete",
              title: "Delete volume",
              body: `Delete volume ${selected.name}?`,
              name: selected.name,
            });
          }}
        >
          Delete
        </button>
      </div>
      {body()}
      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title={dialog.title}
          body={dialog.body}
          confirmLabel="Delete"
          confirmDisabled={busy}
          onCancel={() => {
            if (!busy) setDialog(null);
          }}
          onConfirm={() => void confirmDelete(dialog.name)}
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
