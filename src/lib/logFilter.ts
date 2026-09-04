import type { LogLine } from "./tauri";

export type StreamFilter = "all" | "stdout" | "stderr";

export type LogFilterResult = {
  lines: LogLine[];
  invalidRegex: boolean;
};

export const COPY_CONFIRM_THRESHOLD = 5000;

export function copyNeedsConfirm(count: number): boolean {
  return count > COPY_CONFIRM_THRESHOLD;
}

export function formatLogLineCopy(line: LogLine): string {
  if (line.timestamp_unix_ms == null) return line.raw;
  const date = new Date(line.timestamp_unix_ms);
  if (Number.isNaN(date.getTime())) return line.raw;
  return `${date.toISOString()} ${line.raw}`;
}

export function formatFilteredLogsCopy(lines: LogLine[]): string {
  return lines.map(formatLogLineCopy).join("\n");
}

export function filterLines(
  lines: LogLine[],
  query: string,
  stream: StreamFilter,
  regex = false,
): LogFilterResult {
  const q = query.trim();
  if (regex && q) {
    let compiled: RegExp;
    try {
      compiled = new RegExp(q);
    } catch {
      return { lines: [], invalidRegex: true };
    }
    return {
      invalidRegex: false,
      lines: lines.filter((l) => {
        if (stream !== "all" && l.stream !== stream) return false;
        return compiled.test(l.raw);
      }),
    };
  }
  const needle = q.toLocaleLowerCase();
  return {
    invalidRegex: false,
    lines: lines.filter((l) => {
      if (stream !== "all" && l.stream !== stream) return false;
      if (!needle) return true;
      return l.raw.toLocaleLowerCase().includes(needle);
    }),
  };
}
