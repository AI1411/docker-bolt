export function matchesListQuery(query: string, fields: string[]): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field.toLowerCase().includes(needle));
}

export function filterByQuery<T>(rows: T[], query: string, fields: (row: T) => string[]): T[] {
  return rows.filter((row) => matchesListQuery(query, fields(row)));
}

export function noMatchCopy(
  noun: "containers" | "images" | "volumes" | "compose projects",
  query: string,
  total: number,
  visible: number,
): string | null {
  if (query.trim() && total > 0 && visible === 0) {
    return `No ${noun} match`;
  }
  return null;
}
