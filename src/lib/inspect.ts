export type InspectEnv = {
  name: string;
  value: string;
};

export type InspectMount = {
  source: string;
  destination: string;
};

export function envValueDisplay(value: string, showValues: boolean): string {
  if (showValues) return value;
  return value ? "••••" : "";
}

export function listOrDash(items: string[]): string {
  return items.length === 0 ? "—" : items.join(", ");
}

export function mountLabel(mount: InspectMount): string {
  if (!mount.source) return mount.destination || "—";
  if (!mount.destination) return mount.source;
  return `${mount.source} → ${mount.destination}`;
}

export function shouldReuseInspect(
  cachedGeneration: number | undefined,
  generation: number,
): boolean {
  return cachedGeneration === generation;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target.isContentEditable);
}

export function closeInspectOnEscape(key: string, dialogOpen: boolean, typing: boolean): boolean {
  return key === "Escape" && !dialogOpen && !typing;
}
