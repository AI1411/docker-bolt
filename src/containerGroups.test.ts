import { expect, test } from "vitest";
import {
  buildContainerTableItems,
  containerDisplayName,
  projectSelectionId,
  selectableIds,
  toggleCollapsed,
} from "./lib/containerGroups";
import type { ContainerRow } from "./lib/tauri";

function row(partial: Partial<ContainerRow> & Pick<ContainerRow, "id" | "name">): ContainerRow {
  return {
    image: "img",
    state: partial.running ? "running" : "exited",
    running: false,
    created_unix: 0,
    ...partial,
  };
}

test("groups compose containers under a project row", () => {
  const items = buildContainerTableItems(
    [
      row({
        id: "1",
        name: "shop-db-1",
        compose_project: "shop",
        compose_service: "db",
        image: "mysql:8",
        running: true,
        state: "running",
      }),
      row({
        id: "2",
        name: "shop-web-1",
        compose_project: "shop",
        compose_service: "web",
        image: "nginx",
        running: true,
        state: "running",
      }),
    ],
    { collapsed: new Set() },
  );
  expect(items.map((item) => item.kind)).toEqual(["project", "container", "container"]);
  expect(items[0]).toMatchObject({
    kind: "project",
    project: { project: "shop", status: "running", container_count: 2, running_count: 2 },
  });
  expect(items[1]).toMatchObject({ kind: "container", nested: true });
  expect(containerDisplayName((items[1] as { row: ContainerRow }).row)).toBe("db");
});

test("lists standalone containers without a project header", () => {
  const items = buildContainerTableItems([row({ id: "a", name: "lonely" })], { collapsed: new Set() });
  expect(items).toEqual([
    { kind: "container", nested: false, row: row({ id: "a", name: "lonely" }) },
  ]);
});

test("splits running and stopped sections", () => {
  const items = buildContainerTableItems(
    [
      row({ id: "up", name: "up", running: true, state: "running" }),
      row({
        id: "down",
        name: "stack-web-1",
        compose_project: "stack",
        compose_service: "web",
      }),
    ],
    { collapsed: new Set() },
  );
  expect(items.map((item) => (item.kind === "section" ? item.title : item.kind))).toEqual([
    "Running",
    "container",
    "Stopped",
    "project",
    "container",
  ]);
});

test("hides nested containers when the project is collapsed", () => {
  const rows = [
    row({ id: "1", name: "a", compose_project: "p", compose_service: "a" }),
    row({ id: "2", name: "b", compose_project: "p", compose_service: "b" }),
  ];
  const items = buildContainerTableItems(rows, { collapsed: new Set(["p"]) });
  expect(items.map((item) => item.kind)).toEqual(["project"]);
});

test("keeps a project visible when a nested service matches the query", () => {
  const items = buildContainerTableItems(
    [
      row({ id: "1", name: "shop-db-1", compose_project: "shop", compose_service: "db", image: "mysql" }),
      row({ id: "2", name: "shop-web-1", compose_project: "shop", compose_service: "web", image: "nginx" }),
      row({ id: "3", name: "other", image: "busybox" }),
    ],
    { collapsed: new Set(["shop"]), query: "mysql" },
  );
  expect(items.map((item) => item.kind)).toEqual(["project", "container"]);
  expect((items[1] as { row: ContainerRow }).row.id).toBe("1");
});

test("selectable ids skip section headers", () => {
  const items = buildContainerTableItems(
    [
      row({ id: "up", name: "up", running: true, state: "running" }),
      row({ id: "1", name: "a", compose_project: "p", compose_service: "a" }),
    ],
    { collapsed: new Set() },
  );
  expect(selectableIds(items)).toEqual(["up", projectSelectionId("p"), "1"]);
});

test("toggleCollapsed adds and removes project names", () => {
  expect(toggleCollapsed(["a"], "b")).toEqual(["a", "b"]);
  expect(toggleCollapsed(["a", "b"], "a")).toEqual(["b"]);
});

test("partial projects sit with running work, not in the stopped section", () => {
  const items = buildContainerTableItems(
    [
      row({
        id: "1",
        name: "a",
        compose_project: "mix",
        compose_service: "a",
        running: true,
        state: "running",
      }),
      row({ id: "2", name: "b", compose_project: "mix", compose_service: "b" }),
      row({ id: "3", name: "idle" }),
    ],
    { collapsed: new Set() },
  );
  expect(items.map((item) => (item.kind === "section" ? item.title : item.kind))).toEqual([
    "Running",
    "project",
    "container",
    "container",
    "Stopped",
    "container",
  ]);
  expect(items[1]).toMatchObject({ kind: "project", project: { status: "partial" } });
});
