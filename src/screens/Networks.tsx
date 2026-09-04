import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ListSearch } from "../components/ListSearch";
import { ResourceTile } from "../components/icons";
import { buttonClass } from "../lib/buttonClass";
import { filterByQuery, noMatchCopy } from "../lib/listFilter";
import { listRowA11y } from "../lib/listKeys";
import { isSystemNetwork } from "../lib/networks";
import { useListKeyboard } from "../lib/useListKeyboard";
import { VirtualTable, type VirtualTableHandle } from "../components/VirtualTable";
import { api, ipcErrorCode, ipcErrorMessage } from "../lib/tauri";
import { useConnection } from "../stores/connection";
import { useNetworks } from "../stores/networks";

type Dialog =
  | { kind: "delete"; title: string; body: string; id: string }
  | { kind: "error"; body: string };

export function Networks() {
  const view = useConnection((s) => s.view);
  const retry = useConnection((s) => s.retry);
  const rows = useNetworks((s) => s.rows);
  const loading = useNetworks((s) => s.loading);
  const error = useNetworks((s) => s.error);
  const selectedId = useNetworks((s) => s.selectedId);
  const select = useNetworks((s) => s.select);
  const reload = useNetworks((s) => s.reload);
  const removeRow = useNetworks((s) => s.removeRow);
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      filterByQuery(rows, query, (row) => [
        row.name,
        row.driver ?? "",
        row.scope ?? "",
        row.id,
      ]),
    [rows, query],
  );
  const selected = visible.find((row) => row.id === selectedId) ?? null;
  const canDelete = Boolean(selected && !isSystemNetwork(selected.name));
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<VirtualTableHandle>(null);

  function requestDelete(id: string, name: string) {
    if (busy || isSystemNetwork(name)) return;
    setDialog({
      kind: "delete",
      title: "Delete network",
      body: `Delete network ${name}?`,
      id,
    });
  }

  useListKeyboard({
    ids: visible.map((row) => row.id),
    selectedId,
    onSelect: select,
    searchRef,
    tableRef,
    dialogOpen: Boolean(dialog),
    onDelete: () => {
      const row = useNetworks.getState().rows.find((item) => item.id === useNetworks.getState().selectedId);
      if (!row) return;
      requestDelete(row.id, row.name);
    },
  });

  async function confirmDelete(id: string) {
    setBusy(true);
    try {
      await api.deleteNetwork(id);
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
          <p>Networks show up here once an engine connects.</p>
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
      return <div className="empty">No networks</div>;
    }
    const miss = noMatchCopy("networks", query, rows.length, visible.length);
    if (miss) {
      return <div className="empty">{miss}</div>;
    }
    return (
      <VirtualTable
        ref={tableRef}
        count={visible.length}
        rowHeight={56}
        header={
          <div className="row head" data-cols="networks">
            <span className="cell" />
            <span className="cell">Name</span>
            <span className="cell">Driver</span>
            <span className="cell">Scope</span>
          </div>
        }
        rowRenderer={(index) => {
          const row = visible[index];
          const system = isSystemNetwork(row.name);
          return (
            <div
              className={`row list-row ${row.id === selectedId ? "selected" : ""}`}
              data-cols="networks"
              {...listRowA11y(row.id === selectedId)}
              onClick={() => select(row.id)}
            >
              <ResourceTile kind="network" />
              <span className="cell-stack">
                <span className="cell-primary" title={row.name}>
                  {row.name}
                </span>
                <span className="cell-secondary">{system ? "System" : row.id.slice(0, 12)}</span>
              </span>
              <span className="cell muted">{row.driver || "—"}</span>
              <span className="cell muted">{row.scope || "—"}</span>
            </div>
          );
        }}
      />
    );
  }

  return (
    <div className="screen">
      <div className="toolbar">
        <span className="toolbar-title">Networks</span>
        <ListSearch ref={searchRef} value={query} onChange={setQuery} label="Filter networks" />
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
          className={buttonClass("danger")}
          disabled={!connected || !canDelete || busy}
          onClick={() => selected && requestDelete(selected.id, selected.name)}
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
