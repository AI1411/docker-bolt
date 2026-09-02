import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ContainerRow = {
  id: string;
  name: string;
  image: string;
  image_id?: string;
  state: string;
  running: boolean;
  created_unix: number;
};
export type ImageRow = {
  id: string;
  tags: string[];
  size_bytes: number;
  created_unix: number;
  in_use: boolean;
};
export type VolumeRow = { name: string; driver: string };
export type EngineCandidate = {
  engine_id: string;
  name: string;
  endpoint: string;
  available: boolean;
  unavailable_reason?: string;
};
export type ConnectionView =
  | { status: "connecting" }
  | {
      status: "connected";
      engine_id: string;
      name: string;
      endpoint: string;
      api_version: string;
    }
  | { status: "disconnected"; reason: string; message: string };

/** Ignore a stale `connecting` snapshot so it cannot overwrite connected/disconnected. */
export function shouldApplyConnectionSnapshot(
  current: ConnectionView,
  snapshot: ConnectionView,
): boolean {
  return !(snapshot.status === "connecting" && current.status !== "connecting");
}

export type ResourceName = "containers" | "images" | "volumes";

export type LogLine = {
  seq: number;
  stream: "stdout" | "stderr";
  timestamp_unix_ms?: number;
  raw: string;
};

export type LogsBatch = {
  session_id: string;
  lines: LogLine[];
  omitted: number;
};

export type LogEndedReason = "stopped" | "container_gone" | "disconnected" | "error";

export type LogsEnded = {
  session_id: string;
  reason: LogEndedReason;
};

export type RefreshAll = {
  containers: ContainerRow[];
  images: ImageRow[];
  volumes: VolumeRow[];
};

export const api = {
  listEngines: () => invoke<EngineCandidate[]>("list_engines"),
  connectEngine: (engine_id: string) =>
    invoke<ConnectionView>("connect_engine", { engine_id }),
  connectionStatus: () => invoke<ConnectionView>("connection_status"),
  listContainers: () => invoke<ContainerRow[]>("list_containers"),
  listImages: () => invoke<ImageRow[]>("list_images"),
  listVolumes: () => invoke<VolumeRow[]>("list_volumes"),
  deleteContainer: (id: string) => invoke("delete_container", { id }),
  deleteImage: (id: string) => invoke("delete_image", { id }),
  deleteVolume: (name: string) => invoke("delete_volume", { name }),
  refresh: (resource: ResourceName | "all") =>
    invoke<RefreshAll | ContainerRow[] | ImageRow[] | VolumeRow[]>("refresh", {
      resource,
    }),
  startLogs: (container_id: string) =>
    invoke<{ session_id: string }>("start_logs", { container_id }),
  stopLogs: (session_id: string) => invoke("stop_logs", { session_id }),
};

export function listenConnection(cb: (v: ConnectionView) => void): Promise<UnlistenFn> {
  return listen<ConnectionView>("connection://changed", (e) => cb(e.payload));
}

export function listenInvalidate(
  cb: (resource: ResourceName) => void,
): Promise<UnlistenFn> {
  return listen<{ resource: ResourceName }>("resources://invalidate", (e) =>
    cb(e.payload.resource),
  );
}

export function listenLogsBatch(cb: (batch: LogsBatch) => void): Promise<UnlistenFn> {
  return listen<LogsBatch>("logs://batch", (e) => cb(e.payload));
}

export function listenLogsEnded(cb: (ended: LogsEnded) => void): Promise<UnlistenFn> {
  return listen<LogsEnded>("logs://ended", (e) => cb(e.payload));
}

export function ipcErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message;
    if (rec.error && typeof rec.error === "object") {
      const inner = rec.error as Record<string, unknown>;
      if (typeof inner.message === "string" && inner.message.trim()) {
        return inner.message;
      }
    }
  }
  return "Request failed";
}

export function ipcErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.code === "string") return rec.code;
    if (rec.error && typeof rec.error === "object") {
      const inner = rec.error as Record<string, unknown>;
      if (typeof inner.code === "string") return inner.code;
    }
  }
  return undefined;
}
