import type { ContainerRow } from "./tauri";

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
