import { expect, test } from "vitest";
import { listKeyAction, moveSelectionIndex } from "./lib/listKeys";

test("j/k and arrows move; slash searches; ignored while typing or in a dialog", () => {
  const idle = { typing: false, dialog: false, allowLogs: true };
  expect(listKeyAction("j", idle)).toBe("next");
  expect(listKeyAction("ArrowDown", idle)).toBe("next");
  expect(listKeyAction("k", idle)).toBe("prev");
  expect(listKeyAction("ArrowUp", idle)).toBe("prev");
  expect(listKeyAction("/", idle)).toBe("search");
  expect(listKeyAction("Enter", idle)).toBe("logs");
  expect(listKeyAction("Backspace", idle)).toBe("delete");
  expect(listKeyAction("Delete", idle)).toBe("delete");
  expect(listKeyAction("Escape", idle)).toBe("escape");
  expect(listKeyAction("j", { ...idle, typing: true })).toBe("none");
  expect(listKeyAction("j", { ...idle, dialog: true })).toBe("none");
  expect(listKeyAction("Enter", { ...idle, allowLogs: false })).toBe("none");
});

test("moveSelectionIndex wraps from no selection and clamps at ends", () => {
  expect(moveSelectionIndex(-1, 3, 1)).toBe(0);
  expect(moveSelectionIndex(-1, 3, -1)).toBe(2);
  expect(moveSelectionIndex(0, 3, -1)).toBe(0);
  expect(moveSelectionIndex(2, 3, 1)).toBe(2);
  expect(moveSelectionIndex(1, 3, 1)).toBe(2);
  expect(moveSelectionIndex(0, 0, 1)).toBe(-1);
});
