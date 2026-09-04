import type { ComposeProjectStatus, ContainerRow } from "./tauri";

export function canStartContainer(
  row: ContainerRow | null,
  connected: boolean,
  busy: boolean,
): boolean {
  return Boolean(connected && !busy && row && !row.running);
}

export function canStopContainer(
  row: ContainerRow | null,
  connected: boolean,
  busy: boolean,
): boolean {
  return Boolean(connected && !busy && row?.running);
}

export function canRestartContainer(
  row: ContainerRow | null,
  connected: boolean,
  busy: boolean,
): boolean {
  return Boolean(connected && !busy && row);
}

export function canStartComposeProject(
  status: ComposeProjectStatus | null,
  connected: boolean,
  busy: boolean,
): boolean {
  return Boolean(connected && !busy && status && status !== "running");
}

export function canStopComposeProject(
  status: ComposeProjectStatus | null,
  connected: boolean,
  busy: boolean,
): boolean {
  return Boolean(connected && !busy && status && status !== "stopped");
}
