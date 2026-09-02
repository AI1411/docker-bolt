export function nextEngineId(
  saved: string | undefined,
  candidates: { engine_id: string; available: boolean }[],
): string | undefined {
  if (saved && candidates.some((c) => c.engine_id === saved && c.available)) {
    return saved;
  }
  return candidates.find((c) => c.available)?.engine_id;
}
