import type { LogLine } from "./tauri";

export type StreamFilter = "all" | "stdout" | "stderr";

export function filterLines(
  lines: LogLine[],
  query: string,
  stream: StreamFilter,
): LogLine[] {
  const q = query.trim().toLocaleLowerCase();
  return lines.filter((l) => {
    if (stream !== "all" && l.stream !== stream) return false;
    if (!q) return true;
    return l.raw.toLocaleLowerCase().includes(q);
  });
}
