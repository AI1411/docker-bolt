import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { VirtualTable } from "../components/VirtualTable";
import { fmtTime, shortId } from "../lib/format";
import { api, ipcErrorCode, ipcErrorMessage, type ContainerRow } from "../lib/tauri";
import { useConnection } from "../stores/connection";
import { useContainers } from "../stores/containers";

function deleteCopy(row: ContainerRow): { title: string; body: string } {
  if (row.running) {
    return {
      title: "Delete running container",
      body: `${row.name} is running. Force delete this container?`,
    };
  }
  return {
    title: "Delete container",
    body: `Delete ${row.name}? This cannot be undone.`,
  };
}

type Dialog =
  | { kind: "delete"; title: string; body: string; id: string }
  | { kind: "error"; body: string };

export function Containers() {
  const navigate = useNavigate();
  const view = useConnection((s) => s.view);
  const retry = useConnection((s) => s.retry);
  const rows = useContainers((s) => s.rows);
  const loading = useContainers((s) => s.loading);
  const error = useContainers((s) => s.error);
  const selectedId = useContainers((s) => s.selectedId);
  const select = useContainers((s) => s.select);
  const reload = useContainers((s) => s.reload);
  const removeRow = useContainers((s) => s.removeRow);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!selected || busy) return;
    const copy = deleteCopy(selected);
    setDialog({ kind: "delete", ...copy, id: selected.id });
  }

  async function confirmDelete(id: string) {
    setBusy(true);
    try {
      await api.deleteContainer(id);
      removeRow(id);
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
      return <div className="empty">No containers</div>;
    }
    return (
      <VirtualTable
        count={rows.length}
        rowHeight={32}
        header={
          <div className="row head" data-cols="containers">
            <span className="cell">Name</span>
            <span className="cell">Image</span>
            <span className="cell">State</span>
            <span className="cell">ID</span>
            <span className="cell">Created</span>
          </div>
        }
        rowRenderer={(index) => {
          const row = rows[index];
          return (
            <div
              className={`row ${row.id === selectedId ? "selected" : ""}`}
              data-cols="containers"
              onClick={() => select(row.id)}
            >
              <span className="cell" title={row.name}>
                {row.name}
              </span>
              <span className="cell" title={row.image}>
                {row.image}
              </span>
              <span className="cell">{row.state}</span>
              <span className="cell mono">{shortId(row.id)}</span>
              <span className="cell">{fmtTime(row.created_unix)}</span>
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
        <button type="button" disabled={!connected || !selected || busy} onClick={() => void onDelete()}>
          Delete
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && navigate(`/containers/${encodeURIComponent(selected.id)}/logs`)}
        >
          Logs
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
          onConfirm={() => void confirmDelete(dialog.id)}
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
