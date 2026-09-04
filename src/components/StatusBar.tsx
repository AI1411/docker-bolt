import { StatusPill } from "./StatusPill";
import { buttonClass } from "../lib/buttonClass";
import { nextEngineId } from "../lib/engineSelect";
import { connectionPill } from "../lib/statusPill";
import { useConnection } from "../stores/connection";

export function StatusBar() {
  const view = useConnection((s) => s.view);
  const engines = useConnection((s) => s.engines);
  const connect = useConnection((s) => s.connect);
  const retry = useConnection((s) => s.retry);
  const pill = connectionPill(view.status);

  const selected =
    view.status === "connected"
      ? view.engine_id
      : nextEngineId(undefined, engines) ?? "";

  return (
    <footer className="status-bar">
      <span className="status-text" role="status">
        <StatusPill label={pill.label} tone={pill.tone} pulse={view.status === "connecting"} />
        {view.status === "disconnected" ? <span className="status-message">{view.message}</span> : null}
      </span>
      <select
        aria-label="Engine"
        value={selected}
        disabled={view.status === "connecting" || engines.length === 0}
        onChange={(event) => {
          const engine_id = event.target.value;
          if (engine_id) void connect(engine_id);
        }}
      >
        {view.status !== "connected" && !selected ? (
          <option value="" disabled>
            No engine
          </option>
        ) : null}
        {engines.map((engine) => (
          <option key={engine.engine_id} value={engine.engine_id} disabled={!engine.available}>
            {engine.name}
          </option>
        ))}
      </select>
      {view.status === "disconnected" ? (
        <button type="button" className={buttonClass("primary")} onClick={() => void retry()}>
          Retry
        </button>
      ) : null}
    </footer>
  );
}
