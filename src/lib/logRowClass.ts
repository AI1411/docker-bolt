export function logRowClass(stream: "stdout" | "stderr"): string {
  return stream === "stderr" ? "row log-row stderr" : "row log-row";
}
