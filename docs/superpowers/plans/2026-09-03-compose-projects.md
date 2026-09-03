# Compose Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Compose screen that lists Engine-labeled compose projects and can Start, Stop, and Down them as a whole.

**Architecture:** Group containers by `com.docker.compose.project` in `dockbolt-core`. Tauri exposes `list_compose_projects` / `start_compose_project` / `stop_compose_project` / `down_compose_project`. React adds `/compose` with the same list + toolbar pattern as Containers. No compose.yml, no CLI.

**Tech Stack:** Rust, Tokio, Bollard 0.18, serde, Tauri 2, React 18, TypeScript, Zustand, TanStack Virtual, Vitest

## Global Constraints

- OS: macOS and Linux only. Windows is out of scope.
- Transport: local Unix sockets only. No Remote Docker, TLS, named pipes, or `docker` / `docker compose` CLI spawn.
- UI copy in English. Specs stay Japanese.
- Down = containers + project-labeled networks. Named volumes are never removed.
- Operations are project-wide only. No per-service Start/Stop/logs on this screen.
- After Down, DockBolt cannot Up the project again (no file-based `up`).
- Do not change the `refresh` command JSON. Compose reload uses `list_compose_projects` only.
- Partial failure: finish all targets, return the first error.
- Follow `docs/superpowers/specs/2026-09-03-compose-projects-design.md`.
- Keep existing CI: `npm run lint`, `npm test`, `npm run build`, `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace --locked`.

## File Structure

```text
crates/dockbolt-core/src/types.rs       ResourceKind::Compose, ContainerRow labels, NetworkRow, Compose DTOs
crates/dockbolt-core/src/events.rs      resources_from_docker_type → Vec (container+compose, network→compose)
crates/dockbolt-core/src/client.rs      DockerPort start/stop/list_networks/remove_network
crates/dockbolt-core/src/bollard_client.rs  Bollard impl + yield one EngineEvent per kind
crates/dockbolt-core/src/compose.rs     grouping + start/stop/down (new)
crates/dockbolt-core/src/lib.rs         mod compose; event_tests
crates/dockbolt-core/src/containers.rs  mock DockerPort stubs
crates/dockbolt-core/src/images.rs      mock stubs
crates/dockbolt-core/src/volumes.rs     mock stubs
src-tauri/src/lib.rs                   commands, reconnect invalidate includes compose
src/lib/tauri.ts                       types + api
src/stores/compose.ts                  zustand store (new)
src/screens/Compose.tsx                screen (new)
src/components/Sidebar.tsx             Compose nav
src/App.tsx                            route, clear, invalidate
src/styles.css                         data-cols="compose"
```

Every existing `impl DockerPort` must compile after Task 2. Copy the four stub methods into each mock.

**DockerPort stubs to add to every test mock** (`client.rs` SleepyVersion, `containers.rs` Mock, `images.rs` InUse, `volumes.rs` InUse):

```rust
async fn start_container(&self, _id: &str) -> Result<(), DockboltError> {
    Ok(())
}
async fn stop_container(&self, _id: &str) -> Result<(), DockboltError> {
    Ok(())
}
async fn list_networks(&self) -> Result<Vec<crate::types::NetworkRow>, DockboltError> {
    Ok(vec![])
}
async fn remove_network(&self, _id: &str) -> Result<(), DockboltError> {
    Ok(())
}
```

Also add `compose_project: None, compose_service: None` to every `ContainerRow { ... }` literal that the compiler flags.

---

### Task 1: Types and event mapping

**Files:**
- Modify: `crates/dockbolt-core/src/types.rs`
- Modify: `crates/dockbolt-core/src/events.rs`
- Modify: `crates/dockbolt-core/src/lib.rs` (`event_tests::maps_docker_types`)
- Modify: `crates/dockbolt-core/src/bollard_client.rs` (call site of `resource_from_docker_type`)

**Interfaces:**
- Consumes: existing `ResourceKind`, `EngineEvent`, `InvalidateDebouncer`
- Produces: `ResourceKind::Compose` (`as_str()` → `"compose"`); `resources_from_docker_type(ty: &str) -> Vec<ResourceKind>`; `ContainerRow` optional compose fields; `NetworkRow`; `ComposeProjectStatus`; `ComposeProjectRow`

- [ ] **Step 1: Write the failing test**

In `event_tests::maps_docker_types`, replace the `Option` assertions with:

```rust
assert_eq!(
    resources_from_docker_type("container"),
    vec![ResourceKind::Containers, ResourceKind::Compose]
);
assert_eq!(
    resources_from_docker_type("image"),
    vec![ResourceKind::Images]
);
assert_eq!(
    resources_from_docker_type("volume"),
    vec![ResourceKind::Volumes]
);
assert_eq!(
    resources_from_docker_type("network"),
    vec![ResourceKind::Compose]
);
assert_eq!(resources_from_docker_type("plugin"), Vec::<ResourceKind>::new());
```

Change the import from `resource_from_docker_type` to `resources_from_docker_type`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core event_tests::maps_docker_types --locked`

Expected: FAIL (unresolved `resources_from_docker_type` or `Compose` variant).

- [ ] **Step 3: Write minimal implementation**

`types.rs` — extend `ResourceKind`:

```rust
pub enum ResourceKind {
    Containers,
    Images,
    Volumes,
    Compose,
}

impl ResourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Containers => "containers",
            Self::Images => "images",
            Self::Volumes => "volumes",
            Self::Compose => "compose",
        }
    }
}
```

`ContainerRow` add:

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub compose_project: Option<String>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub compose_service: Option<String>,
```

Add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkRow {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compose_project: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComposeProjectStatus {
    Running,
    Partial,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ComposeProjectRow {
    pub project: String,
    pub status: ComposeProjectStatus,
    pub service_count: u32,
    pub running_count: u32,
    pub container_count: u32,
}
```

`events.rs` — replace `resource_from_docker_type` with:

```rust
pub fn resources_from_docker_type(ty: &str) -> Vec<ResourceKind> {
    match ty {
        "container" => vec![ResourceKind::Containers, ResourceKind::Compose],
        "image" => vec![ResourceKind::Images],
        "volume" => vec![ResourceKind::Volumes],
        "network" => vec![ResourceKind::Compose],
        _ => vec![],
    }
}
```

If anything still calls `resource_from_docker_type`, delete that name (do not keep both).

`bollard_client.rs` events loop:

```rust
for kind in resources_from_docker_type(&ty) {
    yield Ok(EngineEvent { resource: kind });
}
```

Fix every `ContainerRow { ... }` in the crate that does not mention the new fields (`None`, `None`).

- [ ] **Step 4: Run tests**

Run: `cargo test -p dockbolt-core --locked`

Expected: PASS (after ContainerRow literals compile).

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core/src/types.rs crates/dockbolt-core/src/events.rs crates/dockbolt-core/src/lib.rs crates/dockbolt-core/src/bollard_client.rs crates/dockbolt-core/src/containers.rs crates/dockbolt-core/src/images.rs crates/dockbolt-core/src/volumes.rs crates/dockbolt-core/src/client.rs
git commit -m "feat: add Compose resource kind and container compose labels"
```

---

### Task 2: DockerPort start/stop/networks + Bollard

**Files:**
- Modify: `crates/dockbolt-core/src/client.rs`
- Modify: `crates/dockbolt-core/src/bollard_client.rs`
- Modify: `crates/dockbolt-core/src/containers.rs`
- Modify: `crates/dockbolt-core/src/images.rs`
- Modify: `crates/dockbolt-core/src/volumes.rs`

**Interfaces:**
- Consumes: `NetworkRow` from Task 1
- Produces:

```rust
async fn start_container(&self, id: &str) -> Result<(), DockboltError>;
async fn stop_container(&self, id: &str) -> Result<(), DockboltError>;
async fn list_networks(&self) -> Result<Vec<NetworkRow>, DockboltError>;
async fn remove_network(&self, id: &str) -> Result<(), DockboltError>;
```

- [ ] **Step 1: Write the failing test**

In `client.rs` `ping_tests`, after adding the four methods to `SleepyVersion`, add:

```rust
#[tokio::test]
async fn start_stop_network_defaults_succeed_on_sleepy_version() {
    let d = SleepyVersion;
    d.start_container("x").await.unwrap();
    d.stop_container("x").await.unwrap();
    assert!(d.list_networks().await.unwrap().is_empty());
    d.remove_network("n").await.unwrap();
}
```

This will fail to compile until the trait has the methods.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core ping_tests::start_stop_network_defaults_succeed_on_sleepy_version --locked`

Expected: compile FAIL (`DockerPort` missing methods) or test missing.

- [ ] **Step 3: Write minimal implementation**

Add the four methods to the `DockerPort` trait in `client.rs`.

`bollard_client.rs` — fill labels when mapping containers:

```rust
let labels = c.labels.unwrap_or_default();
let compose_project = labels.get("com.docker.compose.project").cloned().filter(|s| !s.is_empty());
let compose_service = labels.get("com.docker.compose.service").cloned().filter(|s| !s.is_empty());
```

Bollard methods (0.18):

```rust
async fn start_container(&self, id: &str) -> Result<(), DockboltError> {
    self.docker
        .start_container::<String>(id, None)
        .await
        .map_err(map_bollard_error)
}

async fn stop_container(&self, id: &str) -> Result<(), DockboltError> {
    self.docker
        .stop_container(id, None)
        .await
        .map_err(map_bollard_error)
}

async fn list_networks(&self) -> Result<Vec<NetworkRow>, DockboltError> {
    let list = self
        .docker
        .list_networks::<String>(None)
        .await
        .map_err(map_bollard_error)?;
    Ok(list
        .into_iter()
        .map(|n| {
            let labels = n.labels.unwrap_or_default();
            NetworkRow {
                id: n.id.unwrap_or_default(),
                name: n.name.unwrap_or_default(),
                compose_project: labels
                    .get("com.docker.compose.project")
                    .cloned()
                    .filter(|s| !s.is_empty()),
            }
        })
        .collect())
}

async fn remove_network(&self, id: &str) -> Result<(), DockboltError> {
    self.docker.remove_network(id).await.map_err(map_bollard_error)
}
```

If `start_container` / `list_networks` generic params differ in 0.18, match the compiler. Do not guess a second API; fix compile errors locally.

Copy the four stubs into every test `DockerPort` impl.

- [ ] **Step 4: Run tests**

Run: `cargo test -p dockbolt-core --locked && cargo clippy -p dockbolt-core --all-targets -- -D warnings`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core
git commit -m "feat: extend DockerPort with start, stop, and networks"
```

---

### Task 3: `build_compose_projects`

**Files:**
- Create: `crates/dockbolt-core/src/compose.rs`
- Modify: `crates/dockbolt-core/src/lib.rs` (`pub mod compose;`)

**Interfaces:**
- Consumes: `ContainerRow`, `ComposeProjectRow`, `ComposeProjectStatus`
- Produces: `pub fn build_compose_projects(containers: &[ContainerRow]) -> Vec<ComposeProjectRow>`

- [ ] **Step 1: Write the failing tests**

Put tests in `compose.rs` under `#[cfg(test)] mod grouping_tests`.

Helper:

```rust
fn row(
    id: &str,
    name: &str,
    running: bool,
    project: Option<&str>,
    service: Option<&str>,
) -> ContainerRow {
    ContainerRow {
        id: id.into(),
        name: name.into(),
        image: "img".into(),
        image_id: String::new(),
        state: if running { "running".into() } else { "exited".into() },
        running,
        created_unix: 0,
        compose_project: project.map(|s| s.to_string()),
        compose_service: service.map(|s| s.to_string()),
    }
}
```

Tests:

```rust
#[test]
fn skips_unlabeled() {
    let rows = vec![row("a", "plain", true, None, None)];
    assert!(build_compose_projects(&rows).is_empty());
}

#[test]
fn includes_stopped() {
    let rows = vec![row("a", "web", false, Some("app"), Some("web"))];
    let out = build_compose_projects(&rows);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].project, "app");
    assert_eq!(out[0].status, ComposeProjectStatus::Stopped);
    assert_eq!(out[0].running_count, 0);
    assert_eq!(out[0].container_count, 1);
}

#[test]
fn status_running_partial_stopped() {
    let running = vec![
        row("1", "a", true, Some("p"), Some("web")),
        row("2", "b", true, Some("p"), Some("db")),
    ];
    assert_eq!(
        build_compose_projects(&running)[0].status,
        ComposeProjectStatus::Running
    );
    let mixed = vec![
        row("1", "a", true, Some("p"), Some("web")),
        row("2", "b", false, Some("p"), Some("db")),
    ];
    assert_eq!(
        build_compose_projects(&mixed)[0].status,
        ComposeProjectStatus::Partial
    );
    let stopped = vec![
        row("1", "a", false, Some("p"), Some("web")),
        row("2", "b", false, Some("p"), Some("db")),
    ];
    assert_eq!(
        build_compose_projects(&stopped)[0].status,
        ComposeProjectStatus::Stopped
    );
}

#[test]
fn service_count_unique_plus_unlabeled() {
    let rows = vec![
        row("1", "a", true, Some("p"), Some("web")),
        row("2", "b", true, Some("p"), Some("web")),
        row("3", "c", true, Some("p"), Some("db")),
        row("4", "d", true, Some("p"), None),
    ];
    assert_eq!(build_compose_projects(&rows)[0].service_count, 3);
}

#[test]
fn sorts_projects_case_insensitive() {
    let rows = vec![
        row("1", "a", false, Some("Zoo"), Some("a")),
        row("2", "b", false, Some("alpha"), Some("a")),
    ];
    let names: Vec<_> = build_compose_projects(&rows)
        .into_iter()
        .map(|p| p.project)
        .collect();
    assert_eq!(names, vec!["alpha", "Zoo"]);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p dockbolt-core grouping_tests --locked`

Expected: FAIL (module/function missing).

- [ ] **Step 3: Write minimal implementation**

```rust
use std::collections::{BTreeMap, HashSet};

use crate::types::{ComposeProjectRow, ComposeProjectStatus, ContainerRow};

pub fn build_compose_projects(containers: &[ContainerRow]) -> Vec<ComposeProjectRow> {
    let mut grouped: BTreeMap<String, Vec<&ContainerRow>> = BTreeMap::new();
    for c in containers {
        if let Some(project) = c.compose_project.as_deref().filter(|s| !s.is_empty()) {
            grouped.entry(project.to_string()).or_default().push(c);
        }
    }
    let mut out: Vec<ComposeProjectRow> = grouped
        .into_iter()
        .map(|(project, members)| {
            let container_count = members.len() as u32;
            let running_count = members.iter().filter(|c| c.running).count() as u32;
            let status = if running_count == 0 {
                ComposeProjectStatus::Stopped
            } else if running_count == container_count {
                ComposeProjectStatus::Running
            } else {
                ComposeProjectStatus::Partial
            };
            let mut named = HashSet::new();
            let mut unlabeled = 0u32;
            for c in &members {
                match c.compose_service.as_deref().filter(|s| !s.is_empty()) {
                    Some(svc) => {
                        named.insert(svc);
                    }
                    None => unlabeled += 1,
                }
            }
            ComposeProjectRow {
                project,
                status,
                service_count: named.len() as u32 + unlabeled,
                running_count,
                container_count,
            }
        })
        .collect();
    out.sort_by(|a, b| a.project.to_lowercase().cmp(&b.project.to_lowercase()));
    out
}
```

`BTreeMap` orders by byte order (`Zoo` before `alpha`). The test wants case-insensitive (`alpha` then `Zoo`), so always sort after grouping; do not rely on BTreeMap order.

- [ ] **Step 4: Run tests**

Run: `cargo test -p dockbolt-core grouping_tests --locked`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core/src/compose.rs crates/dockbolt-core/src/lib.rs
git commit -m "feat: group containers into compose project rows"
```

---

### Task 4: start / stop / down

**Files:**
- Modify: `crates/dockbolt-core/src/compose.rs`

**Interfaces:**
- Consumes: `DockerPort`, `build_compose_projects`, `force_for_container_delete` from `containers`
- Produces:

```rust
pub async fn list_compose_projects(docker: &dyn DockerPort) -> Result<Vec<ComposeProjectRow>, DockboltError>
pub async fn start_compose_project(docker: &dyn DockerPort, project: &str) -> Result<(), DockboltError>
pub async fn stop_compose_project(docker: &dyn DockerPort, project: &str) -> Result<(), DockboltError>
pub async fn down_compose_project(docker: &dyn DockerPort, project: &str) -> Result<(), DockboltError>
```

`not_found` message must include the project name: `DockboltError::NotFound(project.to_string())`.

- [ ] **Step 1: Write the failing tests**

Add `Recording` mock in `compose.rs` tests that records `start`, `stop`, `remove_container(id, force)`, `remove_network`, and whether `list_volumes` / `remove_volume` ran.

```rust
struct Recording {
    containers: Vec<ContainerRow>,
    networks: Vec<NetworkRow>,
    start: Arc<Mutex<Vec<String>>>,
    stop: Arc<Mutex<Vec<String>>>,
    remove_c: Arc<Mutex<Vec<(String, bool)>>>,
    remove_n: Arc<Mutex<Vec<String>>>,
    volume_touch: Arc<Mutex<u32>>,
    fail_start: Option<String>,
}
```

Implement `DockerPort`: `list_containers` returns `self.containers`. `start_container` pushes id then if `fail_start == Some(id)` returns `DockboltError::Internal("boom".into())`. `list_volumes` / `remove_volume` increment `volume_touch`.

Tests (same `row` helper):

```rust
#[tokio::test]
async fn start_only_stopped() {
    let docker = Recording {
        containers: vec![
            row("run", "b-run", true, Some("p"), Some("web")),
            row("stop", "a-stop", false, Some("p"), Some("db")),
        ],
        networks: vec![],
        start: Arc::new(Mutex::new(vec![])),
        // remaining fields...
        fail_start: None,
    };
    start_compose_project(&docker, "p").await.unwrap();
    assert_eq!(*docker.start.lock().unwrap(), vec!["stop".to_string()]);
}

#[tokio::test]
async fn stop_only_running() { /* running id recorded, stopped not */ }

#[tokio::test]
async fn down_removes_project_networks_not_volumes_or_other_projects() {
    // containers for p; networks: project p id "n1", other project "n2", unlabeled "n3"
    down_compose_project(&docker, "p").await.unwrap();
    assert_eq!(*docker.remove_n.lock().unwrap(), vec!["n1".to_string()]);
    assert_eq!(*docker.volume_touch.lock().unwrap(), 0);
}

#[tokio::test]
async fn start_partial_failure_still_starts_both() {
    // two stopped ids "a", "b"; fail_start = Some("b")
    let err = start_compose_project(&docker, "p").await.unwrap_err();
    assert_eq!(err.code(), "internal");
    assert_eq!(*docker.start.lock().unwrap(), vec!["a".to_string(), "b".to_string()]);
}

#[tokio::test]
async fn missing_project_does_not_touch_docker() {
    let err = start_compose_project(&docker, "nope").await.unwrap_err();
    assert_eq!(err.code(), "not_found");
    assert!(docker.start.lock().unwrap().is_empty());
}
```

Fill `Recording` fields completely in each test (no `..Default` unless you derive Default).

Start order is **container name ascending**, so `a-stop` before `b-run`. The start test uses names `a-stop` / `b-run` so the stopped one is first; only `stop` id is started.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p dockbolt-core compose:: --locked`

Expected: FAIL (functions missing).

- [ ] **Step 3: Write minimal implementation**

```rust
fn project_containers<'a>(containers: &'a [ContainerRow], project: &str) -> Vec<&'a ContainerRow> {
    let mut v: Vec<_> = containers
        .iter()
        .filter(|c| c.compose_project.as_deref() == Some(project))
        .collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

fn first_error(errs: Vec<DockboltError>) -> Result<(), DockboltError> {
    match errs.into_iter().next() {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

pub async fn list_compose_projects(
    docker: &dyn DockerPort,
) -> Result<Vec<ComposeProjectRow>, DockboltError> {
    Ok(build_compose_projects(&docker.list_containers().await?))
}

pub async fn start_compose_project(
    docker: &dyn DockerPort,
    project: &str,
) -> Result<(), DockboltError> {
    let list = docker.list_containers().await?;
    let members = project_containers(&list, project);
    if members.is_empty() {
        return Err(DockboltError::NotFound(project.to_string()));
    }
    let mut errs = Vec::new();
    for c in members {
        if !c.running {
            if let Err(e) = docker.start_container(&c.id).await {
                errs.push(e);
            }
        }
    }
    first_error(errs)
}
```

`stop_compose_project`: same, but `if c.running { stop_container }`.

`down_compose_project`:

1. `not_found` if no containers for project  
2. For each member in name order: if `running`, `stop_container` (push err, continue). Then `remove_container(&c.id, force_for_container_delete(c.running))` using the **original** `c.running`  
3. `list_networks`, keep those with `compose_project == Some(project)`, sort by `name`, `remove_network(&n.id)` (if `id` empty, use `name`)  
4. `first_error` of all collected errors  
5. Never call volume methods

- [ ] **Step 4: Run tests**

Run: `cargo test -p dockbolt-core --locked`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core/src/compose.rs
git commit -m "feat: start, stop, and down compose projects via Engine API"
```

---

### Task 5: Tauri IPC

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `list_compose_projects`, `start_compose_project`, `stop_compose_project`, `down_compose_project` from core
- Produces: commands with names exactly:

`list_compose_projects`, `start_compose_project`, `stop_compose_project`, `down_compose_project`

Input struct:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ProjectArg {
    pub project: String,
}
```

- [ ] **Step 1: Write the failing test**

There is no Tauri unit test harness. Add a compile-time check by registering the handlers; verification is `cargo test --workspace --locked`.

Skip a fake test. Instead, immediately after implementation, `cargo test --workspace --locked` must pass.

- [ ] **Step 2: (no failing test to run)**

Skip.

- [ ] **Step 3: Write implementation**

Map like `list_containers`: `docker_from_state`, call core, `.map_err(IpcError::from)`.

```rust
#[tauri::command(rename_all = "snake_case")]
async fn list_compose_projects(
    state: State<'_, AppState>,
) -> Result<Vec<ComposeProjectRow>, IpcError> {
    let docker = docker_from_state(&state).await?;
    dockbolt_core::compose::list_compose_projects(docker.as_ref())
        .await
        .map_err(Into::into)
}

#[tauri::command(rename_all = "snake_case")]
async fn start_compose_project(
    state: State<'_, AppState>,
    project: String,
) -> Result<OkReply, IpcError> {
    let ProjectArg { project } = ProjectArg { project };
    let docker = docker_from_state(&state).await?;
    dockbolt_core::compose::start_compose_project(docker.as_ref(), &project).await?;
    Ok(OkReply { ok: true })
}
```

Same pattern for stop/down. Use existing `OkReply`.

Add the four names to `generate_handler!`.

Change `emit_reconnect_invalidate` to:

```rust
for resource in ["containers", "images", "volumes", "compose"] {
    emit_invalidate(app, resource);
}
```

Do **not** change `refresh` payload.

- [ ] **Step 4: Run tests**

Run: `cargo test --workspace --locked && cargo clippy --workspace --all-targets -- -D warnings`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: expose compose project commands over Tauri IPC"
```

---

### Task 6: React Compose screen

**Files:**
- Modify: `src/lib/tauri.ts`
- Create: `src/stores/compose.ts`
- Create: `src/screens/Compose.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: IPC names from Task 5
- Produces: `/compose` UI; `useCompose`; `api.listComposeProjects` etc.

- [ ] **Step 1: Write the failing test**

Spec says grouping is Rust-only; no required Vitest for grouping. Add a smoke import test that the screen module exports `Compose`:

Create `src/screens/Compose.test.ts`:

```ts
import { expect, test } from "vitest";
import { Compose } from "./Compose";

test("exports compose screen", () => {
  expect(Compose).toBeTypeOf("function");
});
```

This fails until `Compose.tsx` exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/Compose.test.ts`

Expected: FAIL (cannot resolve `./Compose`).

- [ ] **Step 3: Write implementation**

`tauri.ts`:

```ts
export type ComposeProjectStatus = "running" | "partial" | "stopped";
export type ComposeProjectRow = {
  project: string;
  status: ComposeProjectStatus;
  service_count: number;
  running_count: number;
  container_count: number;
};
export type ResourceName = "containers" | "images" | "volumes" | "compose";
```

Add optional `compose_project?: string; compose_service?: string` on `ContainerRow`.

```ts
listComposeProjects: () => invoke<ComposeProjectRow[]>("list_compose_projects"),
startComposeProject: (project: string) =>
  invoke("start_compose_project", { project }),
stopComposeProject: (project: string) =>
  invoke("stop_compose_project", { project }),
downComposeProject: (project: string) =>
  invoke("down_compose_project", { project }),
```

`stores/compose.ts` — copy `containers.ts` but:

- `rows: ComposeProjectRow[]`
- `selectedProject: string | null`
- `select(project: string | null)`
- `reload` calls `api.listComposeProjects()`
- `setRows` keeps selection if that project still exists

`screens/Compose.tsx` — copy Containers layout (not Images multi-select):

- Toolbar: Refresh, Start, Stop, Down  
- Empty: `No compose projects`  
- Columns: Name, Status, Services, Containers (`{running_count}/{container_count}`)  
- `data-cols="compose"`  
- Down opens `ConfirmDialog` with exact copy from the spec:

Title: `Down compose project`  
Body: `{project} will remove {container_count} container(s) and project networks. Named volumes are kept. You cannot start this project again from DockBolt.`  
confirmLabel: `Down`

Start/Stop: no confirm; on error, error dialog (`ipcErrorMessage`). After any command (ok or err), `await reload()`.

Start/Stop/Down disabled when `!connected || !selected || busy`.

Sidebar: NavLink `/compose` labeled `Compose` immediately after Containers.

`App.tsx`:

- import `Compose`, `useCompose`  
- `Route path="/compose"`  
- on disconnect: `useCompose.getState().clear()`  
- `if (resource === "compose") void useCompose.getState().reload();`  
- do not also reload compose on `"containers"` (compose kind is already emitted)

`styles.css`:

```css
.row[data-cols="compose"] {
  grid-template-columns: minmax(90px, 1.6fr) 88px 88px 88px;
}
```

- [ ] **Step 4: Run tests and lint**

Run:

```bash
npx vitest run
npx eslint . --max-warnings 0
npx tsc --noEmit
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/stores/compose.ts src/screens/Compose.tsx src/screens/Compose.test.ts src/components/Sidebar.tsx src/App.tsx src/styles.css
git commit -m "feat: add Compose screen for project start, stop, and down"
```

---

### Task 7: CI gate locally

**Files:** none new

- [ ] **Step 1: Run the same checks as GitHub Actions**

```bash
npm run lint
npm test
npm run build
cargo fmt --all -- --check
cargo clippy --workspace --locked --all-targets -- -D warnings
cargo test --workspace --locked
```

Expected: all PASS. If fmt fails, `cargo fmt --all` and commit `chore: rustfmt compose changes`.

- [ ] **Step 2: Commit only if you formatted or fixed clippy**

- [ ] **Step 3: Done**

No extra docs besides the spec/plan already on the branch.

---

## Spec coverage

| Spec section | Task |
|---|---|
| Compose sidebar `/compose`, columns, empty copy | 6 |
| Start/Stop/Down semantics, confirm copy | 4, 6 |
| Labels, DTOs, grouping, sort | 1, 3 |
| DockerPort methods, Bollard | 2 |
| Partial failure, not_found | 4 |
| IPC names, no refresh JSON change | 5 |
| Events container+network → compose | 1, 5 reconnect |
| Volume APIs unused on down | 4 |
| Out of scope (up, CLI, per-service) | not implemented |
| Tests listed in spec §10 | 3, 4 |
| CI | 7 |
