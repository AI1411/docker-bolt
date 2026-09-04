import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { VirtualTable } from "../components/VirtualTable";
import { filterLines, type StreamFilter } from "../lib/logFilter";
import { StatusPill } from "../components/StatusPill";
import { buttonClass } from "../lib/buttonClass";
import { resourceStatusPill } from "../lib/statusPill";
import { shortId } from "../lib/format";
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
  const omitted = useLogs((s) => s.omitted);
  const endedReason = useLogs((s) => s.endedReason);
  const error = useLogs((s) => s.error);
  const setQuery = useLogs((s) => s.setQuery);
  const setStreamFilter = useLogs((s) => s.setStreamFilter);
  const clearFilters = useLogs((s) => s.clearFilters);
  const filtered = useMemo(
    () => filterLines(lines, query, streamFilter),
    [lines, query, streamFilter],
  );
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

  return (
    <div className="screen">
      <div className="logs-header">
        <span className="logs-name">{name}</span>
        <StatusPill {...resourceStatusPill(container?.state ?? "", running)} />
        {ended ? <span className="logs-ended">{ended}</span> : null}
        {omitted > 0 ? <span className="logs-skipped">Skipped {omitted} lines</span> : null}
      </div>
      <div className="toolbar">
        <input
          className="log-search"
          value={query}
          placeholder="Search logs…"
          onChange={(event) => setQuery(event.target.value)}
        />
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
      </div>
      <VirtualTable
        follow
        count={filtered.length}
        rowHeight={25}
        rowRenderer={(index) => {
          const line = filtered[index];
          return (
            <div
              className={`row log-row${line.stream === "stderr" ? " stderr" : ""}`}
              data-cols="logs"
            >
              <span className="cell mono">{fmtLogTime(line.timestamp_unix_ms)}</span>
              <span className="cell mono" title={line.raw}>
                {line.raw}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
}
