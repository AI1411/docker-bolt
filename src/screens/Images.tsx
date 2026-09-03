import { useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { VirtualTable } from "../components/VirtualTable";
import { fmtBytes, fmtTime, shortId } from "../lib/format";
import {
  buildImageTableItems,
  rangeIds,
  toggleId,
  unusedImageIds,
} from "../lib/imageGroups";
import { api, ipcErrorCode, ipcErrorMessage, type ImageRow } from "../lib/tauri";
import { useConnection } from "../stores/connection";
import { useImages } from "../stores/images";

function imageLabel(row: ImageRow): string {
  return row.tags[0] || shortId(row.id);
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

type Dialog = { kind: "error"; body: string };

export function Images() {
  const view = useConnection((s) => s.view);
  const retry = useConnection((s) => s.retry);
  const rows = useImages((s) => s.rows);
  const loading = useImages((s) => s.loading);
  const error = useImages((s) => s.error);
  const selectedIds = useImages((s) => s.selectedIds);
  const select = useImages((s) => s.select);
  const setSelectedIds = useImages((s) => s.setSelectedIds);
  const reload = useImages((s) => s.reload);
  const removeRows = useImages((s) => s.removeRows);
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const anchorId = useRef<string | null>(null);
  const items = useMemo(() => buildImageTableItems(rows), [rows]);
  const unusedIds = useMemo(() => unusedImageIds(rows), [rows]);
  const selectedUnused = selectedIds.filter((id) => unusedIds.includes(id));
  const selectedInUse = rows.find(
    (row) => row.in_use && selectedIds.length === 1 && selectedIds[0] === row.id,
  );
  const allUnusedSelected = unusedIds.length > 0 && unusedIds.every((id) => selectedIds.includes(id));
  const someUnusedSelected = selectedUnused.length > 0 && !allUnusedSelected;
  const deleteTargets = selectedUnused.length > 0 ? selectedUnused : selectedInUse ? [selectedInUse.id] : [];

  async function deleteImages(ids: string[]) {
    if (busy || ids.length === 0) return;
    setBusy(true);
    const deleted: string[] = [];
    let sawNotFound = false;
    let lastError: string | null = null;
    try {
      for (const id of ids) {
        try {
          await api.deleteImage(id);
          deleted.push(id);
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
    } finally {
      setBusy(false);
    }
  }

  function onUnusedRowClick(
    id: string,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) {
    if (event.shiftKey && anchorId.current) {
      setSelectedIds(rangeIds(unusedIds, anchorId.current, id));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds(toggleId(selectedUnused, id));
      anchorId.current = id;
      return;
    }
    setSelectedIds([id]);
    anchorId.current = id;
  }

  function onUnusedCheck(id: string, event: { shiftKey: boolean }) {
    if (event.shiftKey && anchorId.current) {
      setSelectedIds(rangeIds(unusedIds, anchorId.current, id));
      return;
    }
    setSelectedIds(toggleId(selectedUnused, id));
    anchorId.current = id;
  }

  function toggleAllUnused() {
    setSelectedIds(allUnusedSelected ? [] : unusedIds);
    anchorId.current = unusedIds[0] ?? null;
  }

  function body() {
    if (view.status === "connecting") {
      return (
        <div className="empty">
          <p>Looking for a Docker engine…</p>
          <p>Images show up here once an engine connects.</p>
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
      return <div className="empty">No images</div>;
    }
    return (
      <VirtualTable
        count={items.length}
        rowHeight={32}
        header={
          <div className="row head" data-cols="images">
            <span className="cell" />
            <span className="cell">Tags</span>
            <span className="cell">ID</span>
            <span className="cell">Size</span>
            <span className="cell">Created</span>
            <span className="cell" />
          </div>
        }
        rowRenderer={(index) => {
          const item = items[index];
          if (item.kind === "section") {
            const isUnused = item.title === "Unused";
            return (
              <div className="row section" data-cols="images">
                <span className="cell check">
                  {isUnused ? (
                    <input
                      type="checkbox"
                      checked={allUnusedSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someUnusedSelected;
                      }}
                      disabled={!connected || busy || unusedIds.length === 0}
                      aria-label="Select all unused images"
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
          const tags = row.tags.length > 0 ? row.tags.join(", ") : "<none>";
          const selected = selectedIds.includes(row.id);
          return (
            <div
              className={`row ${selected ? "selected" : ""}`}
              data-cols="images"
              onClick={(event) => {
                if (row.in_use) {
                  select(row.id);
                  return;
                }
                onUnusedRowClick(row.id, event);
              }}
            >
              <span className="cell check">
                {!row.in_use ? (
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!connected || busy}
                    aria-label={`Select ${imageLabel(row)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      onUnusedCheck(row.id, event);
                    }}
                    onChange={() => undefined}
                  />
                ) : null}
              </span>
              <span className="cell" title={tags}>
                {tags}
              </span>
              <span className="cell mono">{shortId(row.id)}</span>
              <span className="cell">{fmtBytes(row.size_bytes)}</span>
              <span className="cell">{fmtTime(row.created_unix)}</span>
              <span className="cell actions">
                {!row.in_use ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Delete"
                    aria-label={`Delete ${imageLabel(row)}`}
                    disabled={!connected || busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteImages([row.id]);
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
        <button type="button" disabled={!connected || loading} onClick={() => void reload()}>
          Refresh
        </button>
        <button
          type="button"
          disabled={!connected || deleteTargets.length === 0 || busy}
          onClick={() => void deleteImages(deleteTargets)}
        >
          Delete{selectedUnused.length > 1 ? ` (${selectedUnused.length})` : ""}
        </button>
      </div>
      {body()}
      {dialog ? (
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
