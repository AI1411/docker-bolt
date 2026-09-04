import { useCallback, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ListSearch } from "../components/ListSearch";
import { ResourceTile } from "../components/icons";
import { buttonClass } from "../lib/buttonClass";
import { filterByQuery, noMatchCopy } from "../lib/listFilter";
import { listRowA11y } from "../lib/listKeys";
import { useListKeyboard } from "../lib/useListKeyboard";
import {
  buildVolumeTableItems,
  rangeIds,
  toggleId,
  unusedVolumeNames,
} from "../lib/volumeGroups";
import { VirtualTable, type VirtualTableHandle } from "../components/VirtualTable";
import { api, ipcErrorCode, ipcErrorMessage, type VolumeRow } from "../lib/tauri";
import { useConnection } from "../stores/connection";
import { useVolumes } from "../stores/volumes";

function volumeInUse(row: VolumeRow): boolean {
  return row.in_use !== false;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 2h4l.4 1H14v1H2V3h3.6L6 2zm1 4v6H6V6h1zm2 0v6H8V6h1zm2 0v6h-1V6h1zM3.5 5H13l-.7 9.1A1 1 0 0 1 11.3 15H4.7a1 1 0 0 1-1-.9L3.5 5z"
      />
    </svg>
  );
}

type Dialog =
  | { kind: "delete"; names: string[] }
  | { kind: "error"; body: string };

export function Volumes() {
  const view = useConnection((s) => s.view);
  const retry = useConnection((s) => s.retry);
  const rows = useVolumes((s) => s.rows);
  const loading = useVolumes((s) => s.loading);
  const error = useVolumes((s) => s.error);
  const selectedNames = useVolumes((s) => s.selectedNames);
  const select = useVolumes((s) => s.select);
  const setSelectedNames = useVolumes((s) => s.setSelectedNames);
  const reload = useVolumes((s) => s.reload);
  const removeRows = useVolumes((s) => s.removeRows);
  const [query, setQuery] = useState("");
  const visibleRows = useMemo(
    () => filterByQuery(rows, query, (row) => [row.name, row.driver]),
    [rows, query],
  );
  const items = useMemo(() => buildVolumeTableItems(visibleRows), [visibleRows]);
  const unusedNames = useMemo(() => unusedVolumeNames(visibleRows), [visibleRows]);
  const selectedUnused = selectedNames.filter((name) => unusedNames.includes(name));
  const allUnusedSelected =
    unusedNames.length > 0 && unusedNames.every((name) => selectedNames.includes(name));
  const someUnusedSelected = selectedUnused.length > 0 && !allUnusedSelected;
  const deleteTargets = selectedUnused;
  const selectedId = selectedNames.length > 0 ? selectedNames[selectedNames.length - 1] : null;
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<VirtualTableHandle>(null);
  const anchorName = useRef<string | null>(null);
  const indexForId = useCallback(
    (id: string) => items.findIndex((item) => item.kind === "volume" && item.row.name === id),
    [items],
  );

  function requestDelete(names: string[]) {
    if (busy || names.length === 0) return;
    setDialog({ kind: "delete", names });
  }

  useListKeyboard({
    ids: visibleRows.map((row) => row.name),
    selectedId,
    onSelect: select,
    searchRef,
    tableRef,
    dialogOpen: Boolean(dialog),
    onDelete: () => {
      const unused = unusedVolumeNames(visibleRows);
      const selected = useVolumes.getState().selectedNames.filter((name) => unused.includes(name));
      requestDelete(selected);
    },
    indexForId,
  });

  function onUnusedRowClick(
    name: string,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) {
    if (event.shiftKey && anchorName.current) {
      setSelectedNames(rangeIds(unusedNames, anchorName.current, name));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedNames(toggleId(selectedUnused, name));
      anchorName.current = name;
      return;
    }
    setSelectedNames([name]);
    anchorName.current = name;
  }

  function onUnusedCheck(name: string, event: { shiftKey: boolean }) {
    if (event.shiftKey && anchorName.current) {
      setSelectedNames(rangeIds(unusedNames, anchorName.current, name));
      return;
    }
    setSelectedNames(toggleId(selectedUnused, name));
    anchorName.current = name;
  }

  function toggleAllUnused() {
    setSelectedNames(allUnusedSelected ? [] : unusedNames);
    anchorName.current = unusedNames[0] ?? null;
  }

  async function confirmDelete(names: string[]) {
    setBusy(true);
    const deleted: string[] = [];
    let sawNotFound = false;
    let lastError: string | null = null;
    try {
      for (const name of names) {
        try {
          await api.deleteVolume(name);
          deleted.push(name);
        } catch (err) {
          if (ipcErrorCode(err) === "not_found") {
            sawNotFound = true;
          } else {
            lastError = ipcErrorMessage(err);
          }
        }
      }
      if (deleted.length > 0) removeRows(deleted);
      if (sawNotFound) await reload();
      if (lastError) setDialog({ kind: "error", body: lastError });
      else setDialog(null);
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
      return <div className="empty">No volumes</div>;
    }
    const miss = noMatchCopy("volumes", query, rows.length, visibleRows.length);
    if (miss) {
      return <div className="empty">{miss}</div>;
    }
    return (
      <VirtualTable
        ref={tableRef}
        count={items.length}
        rowHeight={56}
        header={
          <div className="row head" data-cols="volumes">
            <span className="cell" />
            <span className="cell" />
            <span className="cell">Name</span>
          </div>
        }
        rowRenderer={(index) => {
          const item = items[index];
          if (item.kind === "section") {
            const isUnused = item.title === "Unused";
            return (
              <div className="row section" data-cols="volumes">
                <span className="cell check">
                  {isUnused ? (
                    <input
                      type="checkbox"
                      checked={allUnusedSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someUnusedSelected;
                      }}
                      disabled={!connected || busy || unusedNames.length === 0}
                      aria-label="Select all unused volumes"
                      onChange={toggleAllUnused}
                    />
                  ) : null}
                </span>
                <span className="cell section-title">
                  {item.title} ({item.count})
                </span>
              </div>
            );
          }
          const row = item.row;
          const selected = selectedNames.includes(row.name);
          const inUse = volumeInUse(row);
          return (
            <div
              className={`row list-row ${selected ? "selected" : ""}`}
              data-cols="volumes"
              {...listRowA11y(selected)}
              onClick={(event) => {
                if (inUse) {
                  select(row.name);
                  return;
                }
                onUnusedRowClick(row.name, event);
              }}
            >
              <span className="cell check">
                {!inUse ? (
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!connected || busy}
                    aria-label={`Select ${row.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      onUnusedCheck(row.name, event);
                    }}
                    onChange={() => undefined}
                  />
                ) : null}
              </span>
              <ResourceTile kind="volume" />
              <span className="cell-stack">
                <span className="cell-primary" title={row.name}>
                  {row.name}
                </span>
                <span className="cell-secondary">{row.driver}</span>
              </span>
              <span className="cell actions">
                {!inUse ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Delete"
                    aria-label={`Delete ${row.name}`}
                    disabled={!connected || busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDelete([row.name]);
                    }}
                  >
                    <TrashIcon />
                  </button>
                ) : null}
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
        <span className="toolbar-title">Volumes</span>
        <ListSearch ref={searchRef} value={query} onChange={setQuery} label="Filter volumes" />
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
          disabled={!connected || deleteTargets.length === 0 || busy}
          onClick={() => requestDelete(deleteTargets)}
        >
          Delete{selectedUnused.length > 1 ? ` (${selectedUnused.length})` : ""}
        </button>
      </div>
      {body()}
      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          title={dialog.names.length > 1 ? "Delete volumes" : "Delete volume"}
          body={
            dialog.names.length > 1
              ? `Delete ${dialog.names.length} unused volumes?`
              : `Delete volume ${dialog.names[0]}?`
          }
          confirmLabel="Delete"
          confirmVariant="danger"
          confirmDisabled={busy}
          onCancel={() => {
            if (!busy) setDialog(null);
          }}
          onConfirm={() => void confirmDelete(dialog.names)}
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
