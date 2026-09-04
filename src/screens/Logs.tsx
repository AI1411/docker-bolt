import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { VirtualTable } from "../components/VirtualTable";
import { logRowClass } from "../lib/logRowClass";
import {
  copyNeedsConfirm,
  filterLines,
  formatFilteredLogsCopy,
  type StreamFilter,
} from "../lib/logFilter";
import { StatusPill } from "../components/StatusPill";
import { buttonClass } from "../lib/buttonClass";
import { resourceStatusPill } from "../lib/statusPill";
import { shortId } from "../lib/format";
import { ipcErrorMessage } from "../lib/tauri";
import { useConnection } from "../stores/connection";
import { useContainers } from "../stores/containers";
import { useLogs } from "../stores/logs";

function fmtLogTime(timestamp_unix_ms?: number): string {
  if (timestamp_unix_ms == null) return "";
  const date = new Date(timestamp_unix_ms);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function endedMessage(reason: string | null, error: string | null): string | null {
  if (reason === "container_gone") return "Container not found";
  if (reason === "disconnected") return "Disconnected";
  if (reason === "error") return error || "Log stream failed";
  return null;
}

type Dialog = { kind: "copy"; count: number } | { kind: "error"; body: string };

export function Logs() {
  const { id } = useParams();
  const containerId = id ? decodeURIComponent(id) : "";
  const connectionStatus = useConnection((s) => s.view.status);
  const engineId = useConnection((s) =>
    s.view.status === "connected" ? s.view.engine_id : null,
  );
  const container = useContainers((s) => s.rows.find((row) => row.id === containerId));
  const lines = useLogs((s) => s.lines);
  const query = useLogs((s) => s.query);
  const streamFilter = useLogs((s) => s.streamFilter);
  const paused = useLogs((s) => s.paused);
  const regex = useLogs((s) => s.regex);
  const omitted = useLogs((s) => s.omitted);
  const endedReason = useLogs((s) => s.endedReason);
  const error = useLogs((s) => s.error);
  const setQuery = useLogs((s) => s.setQuery);
  const setStreamFilter = useLogs((s) => s.setStreamFilter);
  const setPaused = useLogs((s) => s.setPaused);
  const setRegex = useLogs((s) => s.setRegex);
  const clearFilters = useLogs((s) => s.clearFilters);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const filteredResult = useMemo(
    () => filterLines(lines, query, streamFilter, regex),
    [lines, query, streamFilter, regex],
  );
  const filtered = filteredResult.lines;
  const name = container?.name ?? (containerId ? shortId(containerId) : "Logs");
  const running = container?.running === true;
  const ended = endedMessage(endedReason, error);

  useEffect(() => {
    if (!containerId) return;
    if (connectionStatus !== "connected") return;
    void useLogs.getState().start(containerId);
    return () => {
      void useLogs.getState().stop();
    };
  }, [containerId, connectionStatus, engineId]);

  async function copyFiltered() {
    try {
      await navigator.clipboard.writeText(formatFilteredLogsCopy(filtered));
      setDialog(null);
    } catch (err) {
      setDialog({ kind: "error", body: ipcErrorMessage(err) });
    }
  }

  function requestCopy() {
    if (copyNeedsConfirm(filtered.length)) {
      setDialog({ kind: "copy", count: filtered.length });
      return;
    }
    void copyFiltered();
  }

  return (
    <div className="screen logs-screen">
      <div className="logs-header">
        <span className="logs-name">{name}</span>
        <StatusPill {...resourceStatusPill(container?.state ?? "", running)} />
        {ended ? <span className="logs-ended">{ended}</span> : null}
        {filteredResult.invalidRegex ? <span className="logs-ended">Invalid regex</span> : null}
        {omitted > 0 ? <span className="logs-skipped">Skipped {omitted} lines</span> : null}
      </div>
      <div className="toolbar">
        <input
          className="log-search"
          value={query}
          placeholder="Search logs…"
          aria-label="Search logs"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className={buttonClass(regex ? "primary" : "ghost")}
          aria-pressed={regex}
          onClick={() => setRegex(!regex)}
        >
          Regex
        </button>
        <select
          aria-label="Stream"
          value={streamFilter}
          onChange={(event) => setStreamFilter(event.target.value as StreamFilter)}
        >
          <option value="all">All</option>
          <option value="stdout">stdout</option>
          <option value="stderr">stderr</option>
        </select>
        <button type="button" className={buttonClass("ghost")} onClick={() => clearFilters()}>
          Clear
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className={buttonClass("ghost")} onClick={() => requestCopy()}>
          Copy
        </button>
      </div>
      <VirtualTable
        follow
        count={filtered.length}
        rowHeight={25}
        rowRenderer={(index) => {
          const line = filtered[index];
          return (
            <div className={logRowClass(line.stream)} data-cols="logs">
              <span className="cell mono time">{fmtLogTime(line.timestamp_unix_ms)}</span>
              <span className="cell mono" title={line.raw}>
                {line.raw}
              </span>
            </div>
          );
        }}
      />
      {dialog?.kind === "copy" ? (
        <ConfirmDialog
          title="Copy log lines"
          body={`Copy ${dialog.count} filtered lines to the clipboard?`}
          confirmLabel="Copy"
          onCancel={() => setDialog(null)}
          onConfirm={() => void copyFiltered()}
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
