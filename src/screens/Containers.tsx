import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InspectPane } from "../components/InspectPane";
import { ListSearch } from "../components/ListSearch";
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
import { filterByQuery, noMatchCopy } from "../lib/listFilter";
import { closeInspectOnEscape, isTypingTarget } from "../lib/inspect";
import {
  browserUrlForPort,
  publishedPortLabel,
  type PublishedPort,
} from "../lib/ports";
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

function rowPorts(row: ContainerRow): PublishedPort[] {
  return row.ports ?? [];
}

function PortsCell({ ports }: { ports: PublishedPort[] }) {
  if (ports.length === 0) {
    return <span className="cell muted">—</span>;
  }
  const shown = ports.slice(0, 2);
  const extra = ports.length - 2;
  return (
    <span className="cell ports-cell">
      {shown.map((port, index) => {
        const url = browserUrlForPort(port);
        const label = publishedPortLabel(port);
        const sep = index > 0 ? ", " : "";
        if (!url) {
          return (
            <span key={`${port.protocol}-${port.host_port}-${index}`}>
              {sep}
              <span className="muted">{label}</span>
            </span>
          );
        }
        return (
          <span key={`${port.protocol}-${port.host_port}-${index}`}>
            {sep}
            <button
              type="button"
              className="port-link"
              title={`Open ${url}`}
              onClick={(event) => {
                event.stopPropagation();
                void api.openUrl(url);
              }}
            >
              {label}
            </button>
          </span>
        );
      })}
      {extra > 0 ? <span className="muted">{` +${extra}`}</span> : null}
    </span>
  );
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
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      filterByQuery(rows, query, (row) => [
        row.name,
        row.image,
        row.state,
        row.id,
        ...rowPorts(row).map(publishedPortLabel),
      ]),
    [rows, query],
  );
  const selected = visible.find((row) => row.id === selectedId) ?? null;
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);

  const onInspectNotFound = useCallback(() => {
    select(null);
    void reload();
  }, [reload, select]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!closeInspectOnEscape(event.key, Boolean(dialog), isTypingTarget(event.target))) {
        return;
      }
      select(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, select]);

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
    const miss = noMatchCopy("containers", query, rows.length, visible.length);
    if (miss) {
      return <div className="empty">{miss}</div>;
    }
    return (
      <VirtualTable
        count={visible.length}
        rowHeight={56}
        rowRenderer={(index) => {
          const row = visible[index];
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
              <PortsCell ports={rowPorts(row)} />
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
        <ListSearch value={query} onChange={setQuery} label="Filter containers" />
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
      <div className={selected ? "screen-split" : "screen-body"}>
        {body()}
        {selected ? (
          <InspectPane
            containerId={selected.id}
            onClose={() => select(null)}
            onNotFound={onInspectNotFound}
          />
        ) : null}
      </div>
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
