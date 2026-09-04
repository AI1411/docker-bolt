import type { ConnectionStatus } from "./chromeTone";

export type PillTone = "ok" | "warn" | "neutral";

export function resourceStatusPill(state: string, running?: boolean): { label: string; tone: PillTone } {
  const raw = state.trim();
  const lower = raw.toLowerCase();
  if (running === true || lower === "running") return { label: "Running", tone: "ok" };
  if (lower === "exited" || lower === "stopped" || lower === "dead") {
    return { label: "Exited", tone: "neutral" };
  }
  if (lower === "created") return { label: "Created", tone: "neutral" };
  if (lower === "paused") return { label: "Paused", tone: "warn" };
  if (!raw) return { label: "Stopped", tone: "neutral" };
  return { label: raw[0].toUpperCase() + raw.slice(1), tone: "neutral" };
}

export function connectionPill(status: ConnectionStatus): { label: string; tone: PillTone } {
  if (status === "connecting") return { label: "Connecting", tone: "warn" };
  if (status === "disconnected") return { label: "Disconnected", tone: "warn" };
  return { label: "Connected", tone: "ok" };
}
