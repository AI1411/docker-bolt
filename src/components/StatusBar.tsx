import { nextEngineId } from "../lib/engineSelect";
import { useConnection } from "../stores/connection";

export function StatusBar() {
  const view = useConnection((s) => s.view);
  const engines = useConnection((s) => s.engines);
  const connect = useConnection((s) => s.connect);
  const retry = useConnection((s) => s.retry);

  const selected =
    view.status === "connected"
      ? view.engine_id
      : nextEngineId(undefined, engines) ?? "";

  let statusText = "Connecting";
  if (view.status === "connected") {
    statusText = view.name;
  } else if (view.status === "disconnected") {
    statusText = view.message;
  }

  return (
    <footer className="status-bar">
      <span className={`status-text ${view.status}`}>{statusText}</span>
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
        <button type="button" onClick={() => void retry()}>
          Retry
        </button>
      ) : null}
    </footer>
  );
}
