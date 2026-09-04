import type { PillTone } from "../lib/statusPill";

export function StatusPill({
  label,
  tone,
  pulse = false,
}: {
  label: string;
  tone: PillTone;
  pulse?: boolean;
}) {
  return (
    <span className={`status-pill ${tone}${pulse ? " pulse" : ""}`}>
      <span className="status-pill-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
