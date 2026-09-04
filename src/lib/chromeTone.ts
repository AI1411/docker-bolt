export type ConnectionStatus = "connected" | "connecting" | "disconnected";
export type ChromeTone = "ok" | "warn" | "neutral";

export function connectionTone(status: ConnectionStatus): ChromeTone {
  if (status === "connecting" || status === "disconnected") return "warn";
  if (status === "connected") return "ok";
  return "neutral";
}

export function connectionStatusClass(status: ConnectionStatus): string {
  const tone = connectionTone(status);
  return `status-text ${status} ${tone}`;
}

export function runDotClass(running: boolean): string {
  return running ? "run-dot running" : "run-dot";
}
