import { afterEach, expect, test } from "vitest";
import { projectSelectionId } from "../lib/containerGroups";
import type { ContainerRow } from "../lib/tauri";
import { useContainers } from "./containers";

function row(partial: Partial<ContainerRow> & Pick<ContainerRow, "id" | "name">): ContainerRow {
  return {
    image: "img",
    state: "exited",
    running: false,
    created_unix: 0,
    ...partial,
  };
}

afterEach(() => {
  useContainers.getState().clear();
});

test("keeps a compose project selected after a member list refresh", () => {
  useContainers.getState().select(projectSelectionId("shop"));
  useContainers.getState().setRows([
    row({ id: "1", name: "web", compose_project: "shop", compose_service: "web" }),
  ]);
  expect(useContainers.getState().selectedId).toBe(projectSelectionId("shop"));
});

test("clears a compose project selection when the project is gone", () => {
  useContainers.getState().select(projectSelectionId("shop"));
  useContainers.getState().setRows([row({ id: "1", name: "lonely" })]);
  expect(useContainers.getState().selectedId).toBeNull();
});
