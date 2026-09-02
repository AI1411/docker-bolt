import { useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { VirtualTable } from "../components/VirtualTable";
import { fmtBytes, fmtTime, shortId } from "../lib/format";
import { buildImageTableItems } from "../lib/imageGroups";
import { api, ipcErrorCode, ipcErrorMessage, type ImageRow } from "../lib/tauri";
import { useConnection } from "../stores/connection";
import { useImages } from "../stores/images";

function imageLabel(row: ImageRow): string {
  return row.tags[0] || shortId(row.id);
}

type Dialog =
  | { kind: "delete"; title: string; body: string; id: string }
  | { kind: "error"; body: string };

export function Images() {
  const view = useConnection((s) => s.view);
  const retry = useConnection((s) => s.retry);
  const rows = useImages((s) => s.rows);
  const loading = useImages((s) => s.loading);
  const error = useImages((s) => s.error);
  const selectedId = useImages((s) => s.selectedId);
  const select = useImages((s) => s.select);
  const reload = useImages((s) => s.reload);
  const removeRow = useImages((s) => s.removeRow);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => buildImageTableItems(rows), [rows]);

  async function confirmDelete(id: string) {
    setBusy(true);
    try {
      await api.deleteImage(id);
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
      return <div className="empty">No images</div>;
    }
    return (
      <VirtualTable
        count={items.length}
        rowHeight={32}
        header={
          <div className="row head" data-cols="images">
            <span className="cell">Tags</span>
            <span className="cell">ID</span>
            <span className="cell">Size</span>
            <span className="cell">Created</span>
          </div>
        }
        rowRenderer={(index) => {
          const item = items[index];
          if (item.kind === "section") {
            return (
              <div className="row section" data-cols="images">
                <span className="cell">
                  {item.title} ({item.count})
                </span>
              </div>
            );
          }
          const row = item.row;
          const tags = row.tags.length > 0 ? row.tags.join(", ") : "<none>";
          return (
            <div
              className={`row ${row.id === selectedId ? "selected" : ""}`}
              data-cols="images"
              onClick={() => select(row.id)}
            >
              <span className="cell" title={tags}>
                {tags}
              </span>
              <span className="cell mono">{shortId(row.id)}</span>
              <span className="cell">{fmtBytes(row.size_bytes)}</span>
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
        <button
          type="button"
          disabled={!connected || !selected || busy}
          onClick={() => {
            if (!selected || busy) return;
            setDialog({
              kind: "delete",
              title: "Delete image",
              body: `Delete ${imageLabel(selected)}?`,
              id: selected.id,
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
