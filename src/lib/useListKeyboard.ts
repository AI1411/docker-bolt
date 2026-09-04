import { useEffect, type RefObject } from "react";
import { isTypingTarget } from "./inspect";
import { listKeyAction, moveSelectionIndex } from "./listKeys";
import type { VirtualTableHandle } from "../components/VirtualTable";

export function useListKeyboard({
  ids,
  selectedId,
  onSelect,
  searchRef,
  tableRef,
  dialogOpen,
  allowLogs = false,
  onLogs,
  onDelete,
  indexForId,
}: {
  ids: string[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  tableRef: RefObject<VirtualTableHandle | null>;
  dialogOpen: boolean;
  allowLogs?: boolean;
  onLogs?: () => void;
  onDelete?: () => void;
  indexForId?: (id: string, idsIndex: number) => number;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const action = listKeyAction(event.key, {
        typing: isTypingTarget(event.target),
        dialog: dialogOpen,
        allowLogs,
      });
      if (action === "none") return;
      event.preventDefault();
      if (action === "search") {
        searchRef.current?.focus();
        return;
      }
      if (action === "escape") {
        searchRef.current?.blur();
        onSelect(null);
        return;
      }
      if (action === "logs") {
        onLogs?.();
        return;
      }
      if (action === "delete") {
        onDelete?.();
        return;
      }
      const current = selectedId ? ids.indexOf(selectedId) : -1;
      const next = moveSelectionIndex(current, ids.length, action === "next" ? 1 : -1);
      if (next < 0) return;
      const id = ids[next];
      onSelect(id);
      const scrollIndex = indexForId ? indexForId(id, next) : next;
      if (scrollIndex >= 0) tableRef.current?.scrollToIndex(scrollIndex);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    allowLogs,
    dialogOpen,
    ids,
    indexForId,
    onDelete,
    onLogs,
    onSelect,
    searchRef,
    selectedId,
    tableRef,
  ]);
}
