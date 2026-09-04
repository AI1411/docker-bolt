import { matchesListQuery } from "./listFilter";
import type { ComposeProjectStatus, ContainerRow } from "./tauri";

export const PROJECT_SELECTION_PREFIX = "project:";

export function projectSelectionId(project: string): string {
  return `${PROJECT_SELECTION_PREFIX}${project}`;
}

export function parseProjectSelection(id: string | null): string | null {
  if (!id?.startsWith(PROJECT_SELECTION_PREFIX)) return null;
  return id.slice(PROJECT_SELECTION_PREFIX.length);
}

export function composeProjectName(row: ContainerRow): string | null {
  const project = row.compose_project?.trim();
  return project ? project : null;
}

export function containerDisplayName(row: ContainerRow): string {
  const service = row.compose_service?.trim();
  return service ? service : row.name;
}

export type ComposeProjectSummary = {
  project: string;
  status: ComposeProjectStatus;
  service_count: number;
  running_count: number;
  container_count: number;
};

export type ContainerTableItem =
  | { kind: "section"; title: "Running" | "Stopped"; count: number }
  | { kind: "project"; project: ComposeProjectSummary }
  | { kind: "container"; row: ContainerRow; nested: boolean };

export function projectStatusLabel(project: ComposeProjectSummary): string {
  if (project.status === "running") return "Running";
  if (project.status === "stopped") return "Stopped";
  return `Partial · ${project.running_count}/${project.container_count}`;
}

export function toggleCollapsed(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function localeSort(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

function projectStatus(running: number, total: number): ComposeProjectStatus {
  if (running === 0) return "stopped";
  if (running === total) return "running";
  return "partial";
}

function summarize(project: string, members: ContainerRow[]): ComposeProjectSummary {
  const running_count = members.filter((row) => row.running).length;
  const named = new Set<string>();
  let unlabeled = 0;
  for (const row of members) {
    const service = row.compose_service?.trim();
    if (service) named.add(service);
    else unlabeled += 1;
  }
  return {
    project,
    status: projectStatus(running_count, members.length),
    service_count: named.size + unlabeled,
    running_count,
    container_count: members.length,
  };
}

function containerFields(row: ContainerRow): string[] {
  return [
    row.name,
    row.image,
    row.state,
    row.id,
    row.compose_project ?? "",
    row.compose_service ?? "",
  ];
}

function sortMembers(members: ContainerRow[]): ContainerRow[] {
  return [...members].sort((a, b) => {
    const byService = localeSort(containerDisplayName(a), containerDisplayName(b));
    if (byService !== 0) return byService;
    return localeSort(a.name, b.name);
  });
}

type BuildOpts = {
  collapsed: ReadonlySet<string>;
  query?: string;
};

type Cluster =
  | { kind: "project"; project: ComposeProjectSummary; members: ContainerRow[] }
  | { kind: "standalone"; row: ContainerRow };

function isRunningCluster(cluster: Cluster): boolean {
  if (cluster.kind === "standalone") return cluster.row.running;
  return cluster.project.status !== "stopped";
}

export function buildContainerTableItems(
  rows: ContainerRow[],
  opts: BuildOpts,
): ContainerTableItem[] {
  const query = opts.query ?? "";
  const grouped = new Map<string, ContainerRow[]>();
  const standalone: ContainerRow[] = [];
  for (const row of rows) {
    const project = composeProjectName(row);
    if (project) {
      const list = grouped.get(project) ?? [];
      list.push(row);
      grouped.set(project, list);
    } else {
      standalone.push(row);
    }
  }

  const clusters: Cluster[] = [];
  for (const name of [...grouped.keys()].sort(localeSort)) {
    const members = sortMembers(grouped.get(name) ?? []);
    const visibleMembers = members.filter((row) => matchesListQuery(query, containerFields(row)));
    const projectHit = matchesListQuery(query, [name]);
    if (!projectHit && visibleMembers.length === 0) continue;
    clusters.push({
      kind: "project",
      project: summarize(name, members),
      members: projectHit ? members : visibleMembers,
    });
  }
  for (const row of [...standalone].sort((a, b) => localeSort(a.name, b.name))) {
    if (!matchesListQuery(query, containerFields(row))) continue;
    clusters.push({ kind: "standalone", row });
  }

  const running = clusters.filter(isRunningCluster);
  const stopped = clusters.filter((cluster) => !isRunningCluster(cluster));
  const both = running.length > 0 && stopped.length > 0;
  const forceExpand = query.trim().length > 0;

  function emit(list: Cluster[], items: ContainerTableItem[]) {
    for (const cluster of list) {
      if (cluster.kind === "standalone") {
        items.push({ kind: "container", row: cluster.row, nested: false });
        continue;
      }
      items.push({ kind: "project", project: cluster.project });
      if (!forceExpand && opts.collapsed.has(cluster.project.project)) continue;
      for (const row of cluster.members) {
        items.push({ kind: "container", row, nested: true });
      }
    }
  }

  const items: ContainerTableItem[] = [];
  if (both) {
    items.push({ kind: "section", title: "Running", count: running.length });
    emit(running, items);
    items.push({ kind: "section", title: "Stopped", count: stopped.length });
    emit(stopped, items);
  } else {
    emit(running.length > 0 ? running : stopped, items);
  }
  return items;
}

export function selectableIds(items: ContainerTableItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === "project") ids.push(projectSelectionId(item.project.project));
    if (item.kind === "container") ids.push(item.row.id);
  }
  return ids;
}
