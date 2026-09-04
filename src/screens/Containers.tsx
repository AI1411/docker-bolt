import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ResourceTile } from "../components/icons";
import { StatusPill } from "../components/StatusPill";
import { buttonClass } from "../lib/buttonClass";
import {
  canRestartContainer,
  canStartContainer,
  canStopContainer,
} from "../lib/containerLifecycle";
import { resourceStatusPill } from "../lib/statusPill";
import { VirtualTable } from "../components/VirtualTable";
import { fmtTime, shortId } from "../lib/format";
import { resourceIconKind } from "../lib/resourceIcon";
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
  | { kind: "restart"; id: string; name: string }
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

  async function runLifecycle(action: "start" | "stop" | "restart", id: string) {
    setBusy(true);
    try {
      if (action === "start") await api.startContainer(id);
      if (action === "stop") await api.stopContainer(id);
      if (action === "restart") await api.restartContainer(id);
      setDialog(null);
      await reload();
    } catch (err) {
      if (ipcErrorCode(err) === "not_found") {
        await reload();
      }
      setDialog({ kind: "error", body: ipcErrorMessage(err) });
    } finally {
      setBusy(false);
    }
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
    if (view.status === "connecting") {
      return (
        <div className="empty">
          <p>Looking for a Docker engine…</p>
          <p>This list fills when an engine connects.</p>
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
      return <div className="empty">No containers</div>;
    }
    return (
      <VirtualTable
        count={rows.length}
        rowHeight={56}
        rowRenderer={(index) => {
          const row = rows[index];
          return (
            <div
              className={`row list-row ${row.id === selectedId ? "selected" : ""}`}
              data-cols="containers"
              onClick={() => select(row.id)}
            >
              <ResourceTile kind={resourceIconKind(row.image)} running={row.running} />
              <span className="cell-stack">
                <span className="cell-primary" title={row.name}>
                  {row.name}
                </span>
                <span className="cell-secondary" title={row.image}>
                  {row.image}
                </span>
              </span>
              <span className="cell">
                <StatusPill {...resourceStatusPill(row.state, row.running)} />
              </span>
              <span className="cell mono muted">{shortId(row.id)}</span>
              <span className="cell muted">{fmtTime(row.created_unix)}</span>
            </div>
          );
        }}
      />
    );
  }

  return (
    <div className="screen">
      <div className="toolbar">
        <span className="toolbar-title">Containers</span>
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
          disabled={!canStartContainer(selected, connected, busy)}
          onClick={() => selected && void runLifecycle("start", selected.id)}
        >
          Start
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!canStopContainer(selected, connected, busy)}
          onClick={() => selected && void runLifecycle("stop", selected.id)}
        >
          Stop
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!canRestartContainer(selected, connected, busy)}
          onClick={() => {
            if (!selected || busy) return;
            setDialog({ kind: "restart", id: selected.id, name: selected.name });
          }}
        >
          Restart
        </button>
        <button
          type="button"
          className={buttonClass("danger")}
          disabled={!connected || !selected || busy}
          onClick={() => void onDelete()}
        >
          Delete
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!selected}
          onClick={() => selected && navigate(`/containers/${encodeURIComponent(selected.id)}/logs`)}
        >
          Logs
        </button>
      </div>
      {body()}
      {dialog?.kind === "restart" ? (
        <ConfirmDialog
          title="Restart container"
          body={`Restart ${dialog.name}?`}
          confirmLabel="Restart"
          confirmVariant="primary"
          confirmDisabled={busy}
          onCancel={() => {
            if (!busy) setDialog(null);
          }}
          onConfirm={() => void runLifecycle("restart", dialog.id)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title={dialog.title}
          body={dialog.body}
          confirmLabel="Delete"
          confirmVariant="danger"
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
