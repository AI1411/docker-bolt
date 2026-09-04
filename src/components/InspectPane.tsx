import { useEffect } from "react";
import { buttonClass } from "../lib/buttonClass";
import { listOrDash, mountLabel } from "../lib/inspect";
import { publishedPortLabel } from "../lib/ports";
import { ipcErrorCode } from "../lib/tauri";
import { useInspect } from "../stores/inspect";

export function InspectPane({
  containerId,
  onClose,
  onNotFound,
}: {
  containerId: string;
  onClose: () => void;
  onNotFound: () => void;
}) {
  const entry = useInspect((s) => s.byId[containerId]);
  const loadingId = useInspect((s) => s.loadingId);
  const error = useInspect((s) => s.error);
  const showValues = useInspect((s) => s.showValues);
  const setShowValues = useInspect((s) => s.setShowValues);
  const load = useInspect((s) => s.load);
  const data = entry?.data;
  const loading = loadingId === containerId && !data;

  useEffect(() => {
    void load(containerId).catch((err) => {
      if (ipcErrorCode(err) === "not_found") onNotFound();
    });
  }, [containerId, load, onNotFound]);

  return (
    <aside className="inspect-pane" aria-label="Container inspect">
      <div className="inspect-head">
        <h2>Inspect</h2>
        <button type="button" className={buttonClass("ghost")} onClick={onClose}>
          Close
        </button>
      </div>
      {loading ? <p className="muted">Loading…</p> : null}
      {error && !loading ? <p className="inspect-error">{error}</p> : null}
      {data ? (
        <dl className="inspect-dl">
          <dt>Name</dt>
          <dd className="mono">{data.name}</dd>
          <dt>ID</dt>
          <dd className="mono">{data.id}</dd>
          <dt>Image</dt>
          <dd className="mono">{data.image || "—"}</dd>
          <dt>State</dt>
          <dd>{data.state || "—"}</dd>
          <dt>Created</dt>
          <dd>{data.created || "—"}</dd>
          <dt>Ports</dt>
          <dd>{listOrDash(data.ports.map((port) => publishedPortLabel(port)))}</dd>
          <dt>Mounts</dt>
          <dd>
            {data.mounts.length === 0
              ? "—"
              : data.mounts.map((mount) => (
                  <div key={`${mount.source}->${mount.destination}`}>{mountLabel(mount)}</div>
                ))}
          </dd>
          <dt>Networks</dt>
          <dd>{listOrDash(data.networks)}</dd>
          <dt>Restart</dt>
          <dd>{data.restart_policy || "—"}</dd>
          <dt>Env</dt>
          <dd>
            <label className="inspect-env-toggle">
              <input
                type="checkbox"
                checked={showValues}
                onChange={(event) => setShowValues(event.target.checked)}
              />
              Show values
            </label>
            {data.env.length === 0
              ? "—"
              : data.env.map((item) => (
                  <div key={item.name} className="mono">
                    {showValues ? `${item.name}=${item.value}` : item.name}
                  </div>
                ))}
          </dd>
        </dl>
      ) : null}
    </aside>
  );
}
