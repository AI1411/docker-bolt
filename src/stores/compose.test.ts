import { afterEach, expect, test, vi } from "vitest";
import { api, type ComposeProjectRow } from "../lib/tauri";
import { useCompose } from "./compose";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function project(project: string): ComposeProjectRow {
  return {
    project,
    status: "running",
    service_count: 1,
    running_count: 1,
    container_count: 1,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  useCompose.getState().clear();
});

test("an older reload cannot overwrite the latest result", async () => {
  const older = deferred<ComposeProjectRow[]>();
  const latest = deferred<ComposeProjectRow[]>();
  vi.spyOn(api, "listComposeProjects")
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(latest.promise);

  const olderReload = useCompose.getState().reload();
  const latestReload = useCompose.getState().reload();

  latest.resolve([project("current")]);
  await latestReload;
  older.resolve([project("stale")]);
  await olderReload;

  expect(useCompose.getState().rows).toEqual([project("current")]);
});

test("clear invalidates an in-flight reload", async () => {
  const pending = deferred<ComposeProjectRow[]>();
  vi.spyOn(api, "listComposeProjects").mockReturnValue(pending.promise);

  const reload = useCompose.getState().reload();
  useCompose.getState().clear();
  pending.resolve([project("stale")]);
  await reload;

  expect(useCompose.getState().rows).toEqual([]);
  expect(useCompose.getState().loading).toBe(false);
});
