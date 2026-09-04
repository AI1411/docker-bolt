import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InspectPane } from "../components/InspectPane";
import { ListSearch } from "../components/ListSearch";
import { ResourceTile } from "../components/icons";
import { buttonClass } from "../lib/buttonClass";
import {
  buildContainerTableItems,
  composeProjectName,
  containerDisplayName,
  parseProjectSelection,
  projectSelectionId,
  projectStatusLabel,
  selectableIds,
  toggleCollapsed,
} from "../lib/containerGroups";
import {
  canRestartContainer,
  canStartComposeProject,
  canStartContainer,
  canStopComposeProject,
  canStopContainer,
} from "../lib/containerLifecycle";
import { composeUpCancelled } from "../lib/composeUp";
import { VirtualTable, type VirtualTableHandle } from "../components/VirtualTable";
import { noMatchCopy } from "../lib/listFilter";
import { listRowA11y } from "../lib/listKeys";
import { useListKeyboard } from "../lib/useListKeyboard";
import {
  browserUrlForPort,
  publishedPortLabel,
  type PublishedPort,
} from "../lib/ports";
import { resourceIconKind } from "../lib/resourceIcon";
import { api, ipcErrorCode, ipcErrorMessage, type ContainerRow } from "../lib/tauri";
import { useCompose } from "../stores/compose";
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

function downCopy(project: string, containerCount: number): { title: string; body: string } {
  return {
    title: "Down compose project",
    body: `${project} will remove ${containerCount} container(s) and project networks. Named volumes are kept. You cannot start this project again from DockBolt.`,
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

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M4.5 2.8v10.4L13.2 8 4.5 2.8z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect fill="currentColor" x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  );
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

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={expanded ? "tree-chevron open" : "tree-chevron"}
    >
      <path
        fill="currentColor"
        d="M6.2 3.2a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06L10.14 8 6.2 4.26a.75.75 0 0 1 0-1.06z"
      />
    </svg>
  );
}

type Dialog =
  | { kind: "delete"; title: string; body: string; id: string }
  | { kind: "down"; title: string; project: string; body: string }
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
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);
  const items = useMemo(
    () => buildContainerTableItems(rows, { collapsed: collapsedSet, query }),
    [rows, collapsedSet, query],
  );
  const ids = useMemo(() => selectableIds(items), [items]);
  const selectedProjectName = parseProjectSelection(selectedId);
  const selectedProjectSummary = (() => {
    if (!selectedProjectName) return null;
    const item = items.find(
      (entry) => entry.kind === "project" && entry.project.project === selectedProjectName,
    );
    return item?.kind === "project" ? item.project : null;
  })();
  const selected =
    selectedProjectName ? null : (rows.find((row) => row.id === selectedId) ?? null);
  const connected = view.status === "connected";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<VirtualTableHandle>(null);

  const onInspectNotFound = useCallback(() => {
    select(null);
    void reload();
  }, [reload, select]);

  const indexForId = useCallback(
    (id: string) =>
      items.findIndex((item) => {
        if (item.kind === "container") return item.row.id === id;
        if (item.kind === "project") return projectSelectionId(item.project.project) === id;
        return false;
      }),
    [items],
  );

  async function refreshLists() {
    await Promise.all([reload(), useCompose.getState().reload()]);
  }

  function requestDeleteContainer(row: ContainerRow) {
    const copy = deleteCopy(row);
    setDialog({ kind: "delete", ...copy, id: row.id });
  }

  function requestDown(project: string, containerCount: number) {
    setDialog({ kind: "down", project, ...downCopy(project, containerCount) });
  }

  useListKeyboard({
    ids,
    selectedId,
    onSelect: select,
    searchRef,
    tableRef,
    dialogOpen: Boolean(dialog),
    allowLogs: !selectedProjectName,
    onLogs: () => {
      const id = useContainers.getState().selectedId;
      if (!id || parseProjectSelection(id)) return;
      navigate(`/containers/${encodeURIComponent(id)}/logs`);
    },
    onDelete: () => {
      const id = useContainers.getState().selectedId;
      if (!id || busy) return;
      const project = parseProjectSelection(id);
      if (project) {
        const count = useContainers
          .getState()
          .rows.filter((row) => composeProjectName(row) === project).length;
        requestDown(project, count);
        return;
      }
      const row = useContainers.getState().rows.find((item) => item.id === id);
      if (row) requestDeleteContainer(row);
    },
    indexForId,
  });

  async function onUp() {
    if (!connected || busy) return;
    setBusy(true);
    try {
      const picked = await api.pickComposeFile();
      if (composeUpCancelled(picked.path)) return;
      await api.upComposeFile(picked.path);
      await refreshLists();
    } catch (err) {
      setDialog({ kind: "error", body: ipcErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function runLifecycle(action: "start" | "stop" | "restart", id: string) {
    setBusy(true);
    try {
      if (action === "start") await api.startContainer(id);
      if (action === "stop") await api.stopContainer(id);
      if (action === "restart") await api.restartContainer(id);
      setDialog(null);
      await refreshLists();
    } catch (err) {
      if (ipcErrorCode(err) === "not_found") {
        await refreshLists();
      }
      setDialog({ kind: "error", body: ipcErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function runCompose(command: (project: string) => Promise<unknown>, project: string) {
    setBusy(true);
    try {
      await command(project);
      setDialog(null);
      await refreshLists();
    } catch (err) {
      setDialog({ kind: "error", body: ipcErrorMessage(err) });
      await refreshLists();
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
        await refreshLists();
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
    const miss = noMatchCopy("containers", query, rows.length, items.length > 0 ? 1 : 0);
    if (miss) {
      return <div className="empty">{miss}</div>;
    }
    return (
      <VirtualTable
        ref={tableRef}
        count={items.length}
        rowHeight={56}
        rowRenderer={(index) => {
          const item = items[index];
          if (item.kind === "section") {
            return (
              <div className="row section" data-cols="containers">
                <span className="cell section-title">
                  {item.title} ({item.count})
                </span>
              </div>
            );
          }
          if (item.kind === "project") {
            const id = projectSelectionId(item.project.project);
            const expanded = !collapsedSet.has(item.project.project) || query.trim().length > 0;
            const running = item.project.status !== "stopped";
            return (
              <div
                className={`row list-row ${id === selectedId ? "selected" : ""}`}
                data-cols="containers"
                {...listRowA11y(id === selectedId)}
                onClick={() => select(id)}
              >
                <button
                  type="button"
                  className="tree-toggle"
                  aria-label={expanded ? `Collapse ${item.project.project}` : `Expand ${item.project.project}`}
                  aria-expanded={expanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCollapsed((current) => toggleCollapsed(current, item.project.project));
                  }}
                >
                  <Chevron expanded={expanded} />
                </button>
                <ResourceTile kind="compose" running={running} />
                <span className="cell-stack">
                  <span className="cell-primary" title={item.project.project}>
                    {item.project.project}
                  </span>
                  <span className="cell-secondary">{projectStatusLabel(item.project)}</span>
                </span>
                <span className="cell muted">
                  {item.project.service_count} services
                </span>
                <span className="cell actions">
                  {canStartComposeProject(item.project.status, connected, busy) ? (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Start"
                      aria-label={`Start ${item.project.project}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void runCompose(api.startComposeProject, item.project.project);
                      }}
                    >
                      <PlayIcon />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Stop"
                      aria-label={`Stop ${item.project.project}`}
                      disabled={!canStopComposeProject(item.project.status, connected, busy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void runCompose(api.stopComposeProject, item.project.project);
                      }}
                    >
                      <StopIcon />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    title="Down"
                    aria-label={`Down ${item.project.project}`}
                    disabled={!connected || busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDown(item.project.project, item.project.container_count);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </span>
              </div>
            );
          }
          const row = item.row;
          const label = containerDisplayName(row);
          return (
            <div
              className={`row list-row ${item.nested ? "nested" : ""} ${row.id === selectedId ? "selected" : ""}`}
              data-cols="containers"
              {...listRowA11y(row.id === selectedId)}
              onClick={() => select(row.id)}
            >
              <span className="tree-spacer" />
              <ResourceTile kind={resourceIconKind(row.image)} running={row.running} />
              <span className="cell-stack">
                <span className="cell-primary" title={label}>
                  {label}
                </span>
                <span className="cell-secondary" title={row.image}>
                  {row.image}
                </span>
              </span>
              <PortsCell ports={rowPorts(row)} />
              <span className="cell actions">
                {canStartContainer(row, connected, busy) ? (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Start"
                    aria-label={`Start ${label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void runLifecycle("start", row.id);
                    }}
                  >
                    <PlayIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Stop"
                    aria-label={`Stop ${label}`}
                    disabled={!canStopContainer(row, connected, busy)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void runLifecycle("stop", row.id);
                    }}
                  >
                    <StopIcon />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  title="Delete"
                  aria-label={`Delete ${label}`}
                  disabled={!connected || busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    requestDeleteContainer(row);
                  }}
                >
                  <TrashIcon />
                </button>
              </span>
            </div>
          );
        }}
      />
    );
  }

  const startEnabled = selectedProjectSummary
    ? canStartComposeProject(selectedProjectSummary.status, connected, busy)
    : canStartContainer(selected, connected, busy);
  const stopEnabled = selectedProjectSummary
    ? canStopComposeProject(selectedProjectSummary.status, connected, busy)
    : canStopContainer(selected, connected, busy);

  return (
    <div className="screen">
      <div className="toolbar">
        <span className="toolbar-title">Containers</span>
        <ListSearch ref={searchRef} value={query} onChange={setQuery} label="Filter containers" />
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!connected || loading}
          onClick={() => void refreshLists()}
        >
          Refresh
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!connected || busy}
          onClick={() => void onUp()}
        >
          Up…
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!startEnabled}
          onClick={() => {
            if (selectedProjectSummary) {
              void runCompose(api.startComposeProject, selectedProjectSummary.project);
              return;
            }
            if (selected) void runLifecycle("start", selected.id);
          }}
        >
          Start
        </button>
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={!stopEnabled}
          onClick={() => {
            if (selectedProjectSummary) {
              void runCompose(api.stopComposeProject, selectedProjectSummary.project);
              return;
            }
            if (selected) void runLifecycle("stop", selected.id);
          }}
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
          disabled={!connected || busy || (!selected && !selectedProjectSummary)}
          onClick={() => {
            if (selectedProjectSummary) {
              requestDown(selectedProjectSummary.project, selectedProjectSummary.container_count);
              return;
            }
            if (selected) requestDeleteContainer(selected);
          }}
        >
          {selectedProjectSummary ? "Down" : "Delete"}
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
      {dialog?.kind === "down" ? (
        <ConfirmDialog
          title={dialog.title}
          body={dialog.body}
          confirmLabel="Down"
          confirmVariant="danger"
          confirmDisabled={busy}
          onCancel={() => {
            if (!busy) setDialog(null);
          }}
          onConfirm={() => void runCompose(api.downComposeProject, dialog.project)}
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
