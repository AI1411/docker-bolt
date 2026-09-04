export type ListKeyAction = "next" | "prev" | "search" | "logs" | "delete" | "escape" | "none";

export function listKeyAction(
  key: string,
  ctx: { typing: boolean; dialog: boolean; allowLogs: boolean },
): ListKeyAction {
  if (ctx.dialog || ctx.typing) return "none";
  if (key === "j" || key === "ArrowDown") return "next";
  if (key === "k" || key === "ArrowUp") return "prev";
  if (key === "/") return "search";
  if (key === "Enter") return ctx.allowLogs ? "logs" : "none";
  if (key === "Backspace" || key === "Delete") return "delete";
  if (key === "Escape") return "escape";
  return "none";
}

export function moveSelectionIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  const next = current + delta;
  if (next < 0) return 0;
  if (next >= count) return count - 1;
  return next;
}

export function listRowA11y(selected: boolean): {
  role: "row";
  tabIndex: number;
  "aria-selected": boolean;
} {
  return {
    role: "row",
    tabIndex: selected ? 0 : -1,
    "aria-selected": selected,
  };
}
