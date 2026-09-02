# DockBolt MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship DockBolt v0.1: a Tauri desktop GUI that lists/deletes local Containers, Images, and Volumes and streams filterable container logs.

**Architecture:** Domain logic lives in `crates/dockbolt-core` behind a `DockerPort` trait. `src-tauri` maps invoke/events to core. React renders virtualized lists and never talks to Docker directly.

**Tech Stack:** Rust, Tokio, Bollard 0.18, serde, thiserror, tracing, chrono, Tauri 2, React 18, TypeScript, Zustand, TanStack Virtual, Vite, Vitest

## Global Constraints

- OS: macOS and Linux only. Windows is out of scope.
- Transport: local Unix sockets only. No Remote Docker, TLS, named pipes, or `docker` CLI spawn.
- Detect: Docker Desktop / OrbStack / Colima default / `/var/run/docker.sock`.
- Engine switch: status bar; persist `selected_engine_id` in `engine.json`.
- Running container delete: confirm then `force=true`. Image/Volume delete: `force=false`; show InUse.
- Logs: single stream with `tail=1000`, `follow=true`, `timestamps=true`, stdout+stderr.
- Lists: Docker Events + manual Refresh. No polling.
- Single-row delete only. UI copy in English. No i18n, splash, file logs, or telemetry.
- IPC names and DTO fields must match `docs/superpowers/specs/2026-09-02-dockbolt-mvp-design.md`.
- Do not implement Compose, Networks, Start/Stop/Restart, Exec, Stats, Pull/Build, regex filters.

## File Structure

```text
Cargo.toml                          workspace
crates/dockbolt-core/Cargo.toml
crates/dockbolt-core/src/lib.rs
crates/dockbolt-core/src/error.rs
crates/dockbolt-core/src/types.rs
crates/dockbolt-core/src/client.rs
crates/dockbolt-core/src/engine.rs
crates/dockbolt-core/src/containers.rs
crates/dockbolt-core/src/images.rs
crates/dockbolt-core/src/volumes.rs
crates/dockbolt-core/src/logs.rs
crates/dockbolt-core/src/events.rs
crates/dockbolt-core/src/bollard_client.rs
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
src-tauri/src/main.rs
src-tauri/src/lib.rs
src-tauri/src/state.rs
package.json
vite.config.ts
tsconfig.json
index.html
src/main.tsx
src/App.tsx
src/styles.css
src/lib/tauri.ts
src/lib/format.ts
src/lib/logFilter.ts
src/stores/connection.ts
src/stores/containers.ts
src/stores/images.ts
src/stores/volumes.ts
src/stores/logs.ts
src/components/Sidebar.tsx
src/components/StatusBar.tsx
src/components/ConfirmDialog.tsx
src/components/VirtualTable.tsx
src/screens/Containers.tsx
src/screens/Images.tsx
src/screens/Volumes.tsx
src/screens/Logs.tsx
src/logFilter.test.ts
src/stores/logs.test.ts
```

---

### Task 1: Cargo workspace and dockbolt-core crate

**Files:**
- Create: `Cargo.toml`
- Create: `crates/dockbolt-core/Cargo.toml`
- Create: `crates/dockbolt-core/src/lib.rs`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: workspace member `dockbolt-core` with `pub fn core_version() -> &'static str`

- [ ] **Step 1: Write the failing test**

Create `crates/dockbolt-core/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::core_version;

    #[test]
    fn core_version_is_semver_prefix() {
        assert!(core_version().starts_with("0.1."));
    }
}
```

Do not define `core_version` yet.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core`
Expected: FAIL compiling (`cannot find function core_version`) or workspace missing.

- [ ] **Step 3: Write minimal implementation**

Root `Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/dockbolt-core"]
```

`crates/dockbolt-core/Cargo.toml`:

```toml
[package]
name = "dockbolt-core"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tracing = "0.1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time", "sync"] }
futures = "0.3"
async-trait = "0.1"
chrono = { version = "0.4", default-features = false, features = ["clock", "std"] }
bytes = "1"
bollard = "0.18"

[dev-dependencies]
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time", "sync"] }
```

Complete `crates/dockbolt-core/src/lib.rs`:

```rust
pub fn core_version() -> &'static str {
    "0.1.0"
}

#[cfg(test)]
mod tests {
    use super::core_version;

    #[test]
    fn core_version_is_semver_prefix() {
        assert!(core_version().starts_with("0.1."));
    }
}
```

Replace `README.md` with:

```markdown
# DockBolt

Lightweight Docker GUI. See `docs/dockbolt_requirements.md` and `docs/superpowers/specs/2026-09-02-dockbolt-mvp-design.md`.
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core`
Expected: PASS (`core_version_is_semver_prefix`)

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/dockbolt-core README.md
git commit -m "chore: add dockbolt-core workspace crate"
```

---

### Task 2: Error type, DTOs, and DockerPort

**Files:**
- Create: `crates/dockbolt-core/src/error.rs`
- Create: `crates/dockbolt-core/src/types.rs`
- Create: `crates/dockbolt-core/src/client.rs`
- Modify: `crates/dockbolt-core/src/lib.rs`

**Interfaces:**
- Consumes: crate skeleton from Task 1
- Produces:
  - `DockboltError` with `code() -> &'static str` and `message() -> String`
  - `DockerPort` trait (methods below)
  - DTO structs: `ContainerRow`, `ImageRow`, `VolumeRow`, `EngineCandidate`, `LogLine`, `LogStream`, `ConnectionView`, `ResourceKind`, `RawLogChunk`, `EngineEvent`

`DockerPort`:

```rust
#[async_trait]
pub trait DockerPort: Send + Sync {
    async fn version(&self) -> Result<String, DockboltError>;
    async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError>;
    async fn remove_container(&self, id: &str, force: bool) -> Result<(), DockboltError>;
    async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError>;
    async fn remove_image(&self, id: &str) -> Result<(), DockboltError>;
    async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError>;
    async fn remove_volume(&self, name: &str) -> Result<(), DockboltError>;
    fn logs(&self, container_id: &str) -> Pin<Box<dyn Stream<Item = Result<RawLogChunk, DockboltError>> + Send>>;
    fn events(&self) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>>;
}
```

- [ ] **Step 1: Write the failing test**

Append to a new `error.rs` test module only (file can exist with tests first in `lib.rs`):

In `crates/dockbolt-core/src/lib.rs` add:

```rust
mod error;
pub use error::DockboltError;

#[cfg(test)]
mod error_code_tests {
    use super::DockboltError;

    #[test]
    fn error_codes_match_spec() {
        assert_eq!(DockboltError::SocketNotFound.code(), "socket_not_found");
        assert_eq!(DockboltError::PermissionDenied.code(), "permission_denied");
        assert_eq!(DockboltError::Timeout.code(), "timeout");
        assert_eq!(
            DockboltError::EngineUnreachable("x".into()).code(),
            "engine_unreachable"
        );
        assert_eq!(DockboltError::NotFound("c".into()).code(), "not_found");
        assert_eq!(
            DockboltError::InUse {
                summary: "vol".into()
            }
            .code(),
            "in_use"
        );
        assert_eq!(DockboltError::Conflict("c".into()).code(), "conflict");
        assert_eq!(DockboltError::Internal("i".into()).code(), "internal");
    }
}
```

Do not create `error.rs` yet.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core error_codes_match_spec -- --exact`
Expected: FAIL (`mod error` file not found or `DockboltError` missing)

- [ ] **Step 3: Write minimal implementation**

`crates/dockbolt-core/src/error.rs`:

```rust
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum DockboltError {
    #[error("no docker socket found")]
    SocketNotFound,
    #[error("permission denied for docker socket")]
    PermissionDenied,
    #[error("docker ping timed out")]
    Timeout,
    #[error("engine unreachable: {0}")]
    EngineUnreachable(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("in use: {summary}")]
    InUse { summary: String },
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Internal(String),
}

impl DockboltError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::SocketNotFound => "socket_not_found",
            Self::PermissionDenied => "permission_denied",
            Self::Timeout => "timeout",
            Self::EngineUnreachable(_) => "engine_unreachable",
            Self::NotFound(_) => "not_found",
            Self::InUse { .. } => "in_use",
            Self::Conflict(_) => "conflict",
            Self::Internal(_) => "internal",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::PermissionDenied => {
                "This user cannot access the Docker socket. Add the user to the docker group or run with sufficient permissions."
                    .to_string()
            }
            other => other.to_string(),
        }
    }
}
```

`crates/dockbolt-core/src/types.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceKind {
    Containers,
    Images,
    Volumes,
}

impl ResourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Containers => "containers",
            Self::Images => "images",
            Self::Volumes => "volumes",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContainerRow {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub running: bool,
    pub created_unix: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageRow {
    pub id: String,
    pub tags: Vec<String>,
    pub size_bytes: u64,
    pub created_unix: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VolumeRow {
    pub name: String,
    pub driver: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EngineCandidate {
    pub engine_id: String,
    pub name: String,
    pub endpoint: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LogLine {
    pub seq: u64,
    pub stream: LogStream,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_unix_ms: Option<i64>,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status")]
pub enum ConnectionView {
    #[serde(rename = "connecting")]
    Connecting,
    #[serde(rename = "connected")]
    Connected {
        engine_id: String,
        name: String,
        endpoint: String,
        api_version: String,
    },
    #[serde(rename = "disconnected")]
    Disconnected { reason: String, message: String },
}

#[derive(Debug, Clone)]
pub struct RawLogChunk {
    pub stream: LogStream,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct EngineEvent {
    pub resource: ResourceKind,
}
```

`crates/dockbolt-core/src/client.rs`:

```rust
use std::pin::Pin;

use async_trait::async_trait;
use futures::Stream;

use crate::error::DockboltError;
use crate::types::{
    ContainerRow, EngineEvent, ImageRow, RawLogChunk, VolumeRow,
};

#[async_trait]
pub trait DockerPort: Send + Sync {
    async fn version(&self) -> Result<String, DockboltError>;
    async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError>;
    async fn remove_container(&self, id: &str, force: bool) -> Result<(), DockboltError>;
    async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError>;
    async fn remove_image(&self, id: &str) -> Result<(), DockboltError>;
    async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError>;
    async fn remove_volume(&self, name: &str) -> Result<(), DockboltError>;
    fn logs(
        &self,
        container_id: &str,
    ) -> Pin<Box<dyn Stream<Item = Result<RawLogChunk, DockboltError>> + Send>>;
    fn events(&self) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>>;
}
```

`lib.rs` modules:

```rust
pub mod client;
pub mod error;
pub mod types;

pub use client::DockerPort;
pub use error::DockboltError;
pub use types::*;

pub fn core_version() -> &'static str {
    "0.1.0"
}
```

Keep the two existing tests.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core`
Expected: PASS including `error_codes_match_spec`

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core
git commit -m "feat: add DockboltError, DTOs, and DockerPort trait"
```

---

### Task 3: Engine detection and selection

**Files:**
- Create: `crates/dockbolt-core/src/engine.rs`
- Modify: `crates/dockbolt-core/src/lib.rs`

**Interfaces:**
- Consumes: `EngineCandidate`, `DockboltError::code`
- Produces:
  - `pub const ENGINE_ORBSTACK: &str = "orbstack";`
  - `pub const ENGINE_DOCKER_DESKTOP: &str = "docker-desktop";`
  - `pub const ENGINE_COLIMA_DEFAULT: &str = "colima-default";`
  - `pub const ENGINE_UNIX_DEFAULT: &str = "unix-default";`
  - `pub fn engine_specs(home: &str) -> Vec<EngineSpec>`
  - `pub struct EngineSpec { pub engine_id, name, socket_path }`
  - `pub fn select_engine_id(saved: Option<&str>, candidates: &[EngineCandidate]) -> Option<String>`
  - `pub fn candidate_from_probe(spec: &EngineSpec, path_exists: bool, ping: Result<(), DockboltError>) -> EngineCandidate`

Ping mapping: `Ok` → available; `Timeout` → unavailable_reason `timeout`; `PermissionDenied` → `permission_denied`; other → `engine_unreachable`. Missing path → available false, reason `socket_not_found`. Endpoint format: `unix://{socket_path}`.

- [ ] **Step 1: Write the failing test**

Add `mod engine;` and tests in `engine.rs` (write tests at the bottom; leave functions missing so compile fails, or put tests in `lib.rs` first).

Put tests in `crates/dockbolt-core/src/engine.rs` together with implementation in Step 3. For TDD, first add only tests in `lib.rs`:

```rust
mod engine;

#[cfg(test)]
mod engine_tests {
    use crate::engine::{
        candidate_from_probe, engine_specs, select_engine_id, ENGINE_COLIMA_DEFAULT,
        ENGINE_DOCKER_DESKTOP, ENGINE_ORBSTACK, ENGINE_UNIX_DEFAULT,
    };
    use crate::DockboltError;

    #[test]
    fn specs_use_priority_order_and_home() {
        let specs = engine_specs("/Users/dev");
        let ids: Vec<_> = specs.iter().map(|s| s.engine_id).collect();
        assert_eq!(
            ids,
            [
                ENGINE_ORBSTACK,
                ENGINE_DOCKER_DESKTOP,
                ENGINE_COLIMA_DEFAULT,
                ENGINE_UNIX_DEFAULT
            ]
        );
        assert_eq!(specs[0].socket_path, "/Users/dev/.orbstack/run/docker.sock");
        assert_eq!(specs[1].socket_path, "/Users/dev/.docker/run/docker.sock");
        assert_eq!(
            specs[2].socket_path,
            "/Users/dev/.colima/default/docker.sock"
        );
        assert_eq!(specs[3].socket_path, "/var/run/docker.sock");
    }

    #[test]
    fn missing_path_is_unavailable() {
        let spec = &engine_specs("/h")[0];
        let c = candidate_from_probe(spec, false, Ok(()));
        assert!(!c.available);
        assert_eq!(c.unavailable_reason.as_deref(), Some("socket_not_found"));
    }

    #[test]
    fn ping_timeout_marks_unavailable() {
        let spec = &engine_specs("/h")[3];
        let c = candidate_from_probe(spec, true, Err(DockboltError::Timeout));
        assert!(!c.available);
        assert_eq!(c.unavailable_reason.as_deref(), Some("timeout"));
        assert_eq!(c.endpoint, "unix:///var/run/docker.sock");
    }

    #[test]
    fn prefer_saved_if_available() {
        let specs = engine_specs("/h");
        let mut orb = candidate_from_probe(&specs[0], true, Ok(()));
        let unix = candidate_from_probe(&specs[3], true, Ok(()));
        orb.available = true;
        let list = vec![orb.clone(), unix];
        assert_eq!(
            select_engine_id(Some(ENGINE_UNIX_DEFAULT), &list).as_deref(),
            Some(ENGINE_UNIX_DEFAULT)
        );
    }

    #[test]
    fn skip_dead_saved_and_use_priority() {
        let specs = engine_specs("/h");
        let mut orb = candidate_from_probe(&specs[0], true, Ok(()));
        let mut unix = candidate_from_probe(&specs[3], true, Err(DockboltError::Timeout));
        unix.available = false;
        orb.available = true;
        let list = vec![orb, unix];
        assert_eq!(
            select_engine_id(Some(ENGINE_UNIX_DEFAULT), &list).as_deref(),
            Some(ENGINE_ORBSTACK)
        );
    }

    #[test]
    fn none_when_all_down() {
        let specs = engine_specs("/h");
        let c = candidate_from_probe(&specs[0], false, Ok(()));
        assert_eq!(select_engine_id(None, &[c]), None);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core engine_tests -- --test-threads=1`
Expected: FAIL (`mod engine` missing)

- [ ] **Step 3: Write minimal implementation**

`crates/dockbolt-core/src/engine.rs`:

```rust
use crate::error::DockboltError;
use crate::types::EngineCandidate;

pub const ENGINE_ORBSTACK: &str = "orbstack";
pub const ENGINE_DOCKER_DESKTOP: &str = "docker-desktop";
pub const ENGINE_COLIMA_DEFAULT: &str = "colima-default";
pub const ENGINE_UNIX_DEFAULT: &str = "unix-default";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineSpec {
    pub engine_id: &'static str,
    pub name: &'static str,
    pub socket_path: String,
}

pub fn engine_specs(home: &str) -> Vec<EngineSpec> {
    vec![
        EngineSpec {
            engine_id: ENGINE_ORBSTACK,
            name: "OrbStack",
            socket_path: format!("{home}/.orbstack/run/docker.sock"),
        },
        EngineSpec {
            engine_id: ENGINE_DOCKER_DESKTOP,
            name: "Docker Desktop",
            socket_path: format!("{home}/.docker/run/docker.sock"),
        },
        EngineSpec {
            engine_id: ENGINE_COLIMA_DEFAULT,
            name: "Colima",
            socket_path: format!("{home}/.colima/default/docker.sock"),
        },
        EngineSpec {
            engine_id: ENGINE_UNIX_DEFAULT,
            name: "Docker Engine",
            socket_path: "/var/run/docker.sock".to_string(),
        },
    ]
}

pub fn candidate_from_probe(
    spec: &EngineSpec,
    path_exists: bool,
    ping: Result<(), DockboltError>,
) -> EngineCandidate {
    let endpoint = format!("unix://{}", spec.socket_path);
    if !path_exists {
        return EngineCandidate {
            engine_id: spec.engine_id.to_string(),
            name: spec.name.to_string(),
            endpoint,
            available: false,
            unavailable_reason: Some("socket_not_found".into()),
        };
    }
    match ping {
        Ok(()) => EngineCandidate {
            engine_id: spec.engine_id.to_string(),
            name: spec.name.to_string(),
            endpoint,
            available: true,
            unavailable_reason: None,
        },
        Err(err) => EngineCandidate {
            engine_id: spec.engine_id.to_string(),
            name: spec.name.to_string(),
            endpoint,
            available: false,
            unavailable_reason: Some(err.code().to_string()),
        },
    }
}

pub fn select_engine_id(
    saved: Option<&str>,
    candidates: &[EngineCandidate],
) -> Option<String> {
    if let Some(id) = saved {
        if candidates
            .iter()
            .any(|c| c.engine_id == id && c.available)
        {
            return Some(id.to_string());
        }
    }
    candidates
        .iter()
        .find(|c| c.available)
        .map(|c| c.engine_id.clone())
}
```

Add `pub mod engine;` and `pub use engine::*;` in `lib.rs`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core engine_tests`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core
git commit -m "feat: detect local docker engines and choose by priority"
```

---

### Task 4: Container list mapping and delete force rules

**Files:**
- Create: `crates/dockbolt-core/src/containers.rs`
- Modify: `crates/dockbolt-core/src/lib.rs`

**Interfaces:**
- Consumes: `ContainerRow`, `DockerPort::remove_container(id, force)`
- Produces:
  - `pub fn normalize_container_name(names: &[String], id: &str) -> String`
  - `pub fn sort_containers(rows: &mut [ContainerRow])`
  - `pub fn force_for_container_delete(running: bool) -> bool`
  - `pub async fn delete_container(docker: &dyn DockerPort, row: &ContainerRow) -> Result<(), DockboltError>` (calls `remove_container` with that force)

- [ ] **Step 1: Write the failing test**

Add to `lib.rs`:

```rust
mod containers;

#[cfg(test)]
mod container_tests {
    use crate::containers::{
        force_for_container_delete, normalize_container_name, sort_containers,
    };
    use crate::ContainerRow;

    fn row(name: &str, running: bool) -> ContainerRow {
        ContainerRow {
            id: format!("id-{name}"),
            name: name.into(),
            image: "img".into(),
            state: if running { "running" } else { "exited" }.into(),
            running,
            created_unix: 0,
        }
    }

    #[test]
    fn strips_slash_and_falls_back_to_short_id() {
        assert_eq!(
            normalize_container_name(&["/api".into()], "abcdefghijklmnop"),
            "api"
        );
        assert_eq!(normalize_container_name(&[], "abcdefghijklmnop"), "abcdefghijkl");
    }

    #[test]
    fn running_sorts_before_name() {
        let mut rows = vec![row("b", false), row("a", false), row("z", true)];
        sort_containers(&mut rows);
        assert_eq!(
            rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            ["z", "a", "b"]
        );
    }

    #[test]
    fn force_only_when_running() {
        assert!(force_for_container_delete(true));
        assert!(!force_for_container_delete(false));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core container_tests`
Expected: FAIL (`mod containers` missing)

- [ ] **Step 3: Write minimal implementation**

`crates/dockbolt-core/src/containers.rs`:

```rust
use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::ContainerRow;

pub fn normalize_container_name(names: &[String], id: &str) -> String {
    if let Some(raw) = names.first() {
        let trimmed = raw.trim_start_matches('/');
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    id.chars().take(12).collect()
}

pub fn sort_containers(rows: &mut [ContainerRow]) {
    rows.sort_by(|a, b| b.running.cmp(&a.running).then_with(|| a.name.cmp(&b.name)));
}

pub fn force_for_container_delete(running: bool) -> bool {
    running
}

pub async fn delete_container(
    docker: &dyn DockerPort,
    row: &ContainerRow,
) -> Result<(), DockboltError> {
    docker
        .remove_container(&row.id, force_for_container_delete(row.running))
        .await
}

#[cfg(test)]
mod delete_tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{EngineEvent, ImageRow, RawLogChunk, VolumeRow};
    use async_trait::async_trait;
    use futures::Stream;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};

    struct Mock {
        last_force: Arc<Mutex<Option<bool>>>,
    }

    #[async_trait]
    impl DockerPort for Mock {
        async fn version(&self) -> Result<String, DockboltError> {
            Ok("1".into())
        }
        async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_container(&self, _id: &str, force: bool) -> Result<(), DockboltError> {
            *self.last_force.lock().unwrap() = Some(force);
            Ok(())
        }
        async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_image(&self, _id: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_volume(&self, _name: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        fn logs(
            &self,
            _container_id: &str,
        ) -> Pin<Box<dyn Stream<Item = Result<RawLogChunk, DockboltError>> + Send>> {
            Box::pin(futures::stream::empty())
        }
        fn events(
            &self,
        ) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>> {
            Box::pin(futures::stream::empty())
        }
    }

    #[tokio::test]
    async fn running_delete_uses_force() {
        let last = Arc::new(Mutex::new(None));
        let docker = Mock {
            last_force: last.clone(),
        };
        let row = ContainerRow {
            id: "abc".into(),
            name: "api".into(),
            image: "img".into(),
            state: "running".into(),
            running: true,
            created_unix: 1,
        };
        delete_container(&docker, &row).await.unwrap();
        assert_eq!(*last.lock().unwrap(), Some(true));
    }

    #[tokio::test]
    async fn stopped_delete_does_not_force() {
        let last = Arc::new(Mutex::new(None));
        let docker = Mock {
            last_force: last.clone(),
        };
        let row = ContainerRow {
            id: "abc".into(),
            name: "api".into(),
            image: "img".into(),
            state: "exited".into(),
            running: false,
            created_unix: 1,
        };
        delete_container(&docker, &row).await.unwrap();
        assert_eq!(*last.lock().unwrap(), Some(false));
    }
}
```

Add `pub mod containers;` to `lib.rs`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core container_tests delete_tests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core
git commit -m "feat: sort containers and force-delete only when running"
```

---

### Task 5: Image and volume delete without force

**Files:**
- Create: `crates/dockbolt-core/src/images.rs`
- Create: `crates/dockbolt-core/src/volumes.rs`
- Modify: `crates/dockbolt-core/src/lib.rs`

**Interfaces:**
- Consumes: `DockerPort::remove_image`, `remove_volume`
- Produces:
  - `pub fn sort_images(rows: &mut [ImageRow])` by `tags.first().unwrap_or(&id)`
  - `pub fn sort_volumes(rows: &mut [VolumeRow])` by name
  - `pub async fn delete_image(docker: &dyn DockerPort, id: &str) -> Result<(), DockboltError>` always `remove_image` (no force parameter)
  - `pub async fn delete_volume(docker: &dyn DockerPort, name: &str) -> Result<(), DockboltError>` always `remove_volume`

- [ ] **Step 1: Write the failing test**

```rust
mod images;
mod volumes;

#[cfg(test)]
mod image_volume_tests {
    use crate::images::sort_images;
    use crate::volumes::sort_volumes;
    use crate::{ImageRow, VolumeRow};

    #[test]
    fn images_sort_by_first_tag() {
        let mut rows = vec![
            ImageRow {
                id: "b".into(),
                tags: vec!["zeta".into()],
                size_bytes: 1,
                created_unix: 0,
            },
            ImageRow {
                id: "a".into(),
                tags: vec![],
                size_bytes: 1,
                created_unix: 0,
            },
        ];
        sort_images(&mut rows);
        assert_eq!(rows[0].id, "a");
        assert_eq!(rows[1].id, "b");
    }

    #[test]
    fn volumes_sort_by_name() {
        let mut rows = vec![
            VolumeRow {
                name: "b".into(),
                driver: "local".into(),
            },
            VolumeRow {
                name: "a".into(),
                driver: "local".into(),
            },
        ];
        sort_volumes(&mut rows);
        assert_eq!(rows[0].name, "a");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core image_volume_tests`
Expected: FAIL (`mod images` missing)

- [ ] **Step 3: Write minimal implementation**

`crates/dockbolt-core/src/images.rs`:

```rust
use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::ImageRow;

pub fn sort_images(rows: &mut [ImageRow]) {
    rows.sort_by(|a, b| {
        let ak = a.tags.first().cloned().unwrap_or_else(|| a.id.clone());
        let bk = b.tags.first().cloned().unwrap_or_else(|| b.id.clone());
        ak.cmp(&bk)
    });
}

pub async fn delete_image(docker: &dyn DockerPort, id: &str) -> Result<(), DockboltError> {
    docker.remove_image(id).await
}
```

`crates/dockbolt-core/src/volumes.rs`:

```rust
use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::VolumeRow;

pub fn sort_volumes(rows: &mut [VolumeRow]) {
    rows.sort_by(|a, b| a.name.cmp(&b.name));
}

pub async fn delete_volume(docker: &dyn DockerPort, name: &str) -> Result<(), DockboltError> {
    docker.remove_volume(name).await
}
```

Add a tokio test in `images.rs` that a mock `remove_image` is called, and one in `volumes.rs` that InUse is propagated:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{ContainerRow, EngineEvent, RawLogChunk, VolumeRow};
    use async_trait::async_trait;
    use futures::Stream;
    use std::pin::Pin;

    struct InUse;

    #[async_trait]
    impl DockerPort for InUse {
        async fn version(&self) -> Result<String, DockboltError> {
            Ok("1".into())
        }
        async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_container(&self, _id: &str, _force: bool) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_image(&self, _id: &str) -> Result<(), DockboltError> {
            Err(DockboltError::InUse {
                summary: "image used by container".into(),
            })
        }
        async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_volume(&self, _name: &str) -> Result<(), DockboltError> {
            Err(DockboltError::InUse {
                summary: "volume in use".into(),
            })
        }
        fn logs(
            &self,
            _container_id: &str,
        ) -> Pin<Box<dyn Stream<Item = Result<RawLogChunk, DockboltError>> + Send>> {
            Box::pin(futures::stream::empty())
        }
        fn events(
            &self,
        ) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>> {
            Box::pin(futures::stream::empty())
        }
    }

    #[tokio::test]
    async fn image_in_use_is_not_retried_with_force() {
        let err = delete_image(&InUse, "sha").await.unwrap_err();
        assert_eq!(err.code(), "in_use");
    }

    #[tokio::test]
    async fn volume_in_use_is_not_retried_with_force() {
        let err = delete_volume(&InUse, "data").await.unwrap_err();
        assert_eq!(err.code(), "in_use");
    }
}
```

Put the InUse mock tests only in `volumes.rs` (both image and volume) to avoid duplicating the mock twice — actually the skill forbids "similar to Task N" but duplicating mock in images.rs and volumes.rs is OK. Keep both tests in `volumes.rs` as shown (calls `delete_image` so `volumes.rs` must `use crate::images::delete_image` for the image test). Cleaner: image test in `images.rs`, volume test in `volumes.rs`. Duplicate the mock in both files in full (do not write "copy from images.rs").

Duplicate the full `InUse` mock in `images.rs` with only `image_in_use_is_not_retried_with_force`, and in `volumes.rs` with only `volume_in_use_is_not_retried_with_force`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core
git commit -m "feat: list sort and non-force image/volume delete"
```

---

### Task 6: Log line parse, batch, ring omit

**Files:**
- Create: `crates/dockbolt-core/src/logs.rs`
- Modify: `crates/dockbolt-core/src/lib.rs`

**Interfaces:**
- Consumes: `LogLine`, `LogStream`, `RawLogChunk`
- Produces:
  - `pub const LOG_TAIL: &str = "1000";`
  - `pub const LOG_BATCH_LINES: usize = 200;`
  - `pub const LOG_BATCH_WINDOW: Duration = Duration::from_millis(16);`
  - `pub const LOG_CHANNEL_CAPACITY: usize = 1024;`
  - `pub const LOG_RING_MAX: usize = 20_000;`
  - `pub fn parse_docker_log_text(text: &str) -> (Option<i64>, String)`
  - `pub fn should_flush(buffered_lines: usize, elapsed: Duration) -> bool`
  - `pub struct LogSeq(u64)` with `next_line(stream, timestamp_unix_ms, raw) -> LogLine`
  - `pub fn push_ring(lines: &mut Vec<LogLine>, incoming: Vec<LogLine>)` drops from front past 20_000
  - `pub struct BatchQueue` with `push_batch(&mut self, lines: Vec<LogLine>) -> u64` where if len would exceed 1024 **batches** wait: spec says channel capacity 1024 of **chunks**. Model: `VecDeque<Vec<LogLine>>` capacity 1024 batches; on overflow pop_front and return omitted count of that batch's lines.

- [ ] **Step 1: Write the failing test**

```rust
mod logs;

#[cfg(test)]
mod log_unit_tests {
    use std::time::Duration;
    use crate::logs::{
        parse_docker_log_text, push_ring, should_flush, BatchQueue, LogSeq, LOG_BATCH_LINES,
        LOG_RING_MAX,
    };
    use crate::LogStream;

    #[test]
    fn splits_rfc3339_prefix() {
        let (ts, raw) = parse_docker_log_text("2024-01-02T03:04:05.000000000Z hello");
        assert!(ts.is_some());
        assert_eq!(raw, "hello");
    }

    #[test]
    fn unparsed_keeps_whole_line() {
        let (ts, raw) = parse_docker_log_text("not a timestamp");
        assert_eq!(ts, None);
        assert_eq!(raw, "not a timestamp");
    }

    #[test]
    fn flush_on_count_or_time() {
        assert!(should_flush(LOG_BATCH_LINES, Duration::from_millis(0)));
        assert!(should_flush(1, Duration::from_millis(16)));
        assert!(!should_flush(1, Duration::from_millis(15)));
    }

    #[test]
    fn seq_increments() {
        let mut seq = LogSeq::default();
        let a = seq.next_line(LogStream::Stdout, None, "a".into());
        let b = seq.next_line(LogStream::Stderr, None, "b".into());
        assert_eq!(a.seq, 1);
        assert_eq!(b.seq, 2);
        assert_eq!(b.stream, LogStream::Stderr);
    }

    #[test]
    fn ring_drops_oldest() {
        let mut lines = Vec::new();
        let mut seq = LogSeq::default();
        let extra = 10;
        let incoming: Vec<_> = (0..(LOG_RING_MAX + extra))
            .map(|_| seq.next_line(LogStream::Stdout, None, "x".into()))
            .collect();
        push_ring(&mut lines, incoming);
        assert_eq!(lines.len(), LOG_RING_MAX);
        assert_eq!(lines[0].seq, extra as u64 + 1);
    }

    #[test]
    fn batch_queue_omits_oldest_when_full() {
        let mut q = BatchQueue::new(2);
        assert_eq!(q.push_batch(vec![]), 0);
        let mut seq = LogSeq::default();
        let batch1: Vec<_> = (0..3)
            .map(|_| seq.next_line(LogStream::Stdout, None, "1".into()))
            .collect();
        let batch2: Vec<_> = (0..1)
            .map(|_| seq.next_line(LogStream::Stdout, None, "2".into()))
            .collect();
        let batch3: Vec<_> = (0..1)
            .map(|_| seq.next_line(LogStream::Stdout, None, "3".into()))
            .collect();
        q.push_batch(batch1);
        q.push_batch(batch2);
        let omitted = q.push_batch(batch3);
        assert_eq!(omitted, 3);
    }
}
```

`BatchQueue::new(2)` is for the test (capacity 2). Production uses `BatchQueue::new(LOG_CHANNEL_CAPACITY)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core log_unit_tests`
Expected: FAIL (`mod logs` missing)

- [ ] **Step 3: Write minimal implementation**

`crates/dockbolt-core/src/logs.rs`:

```rust
use std::collections::VecDeque;
use std::time::Duration;

use chrono::DateTime;

use crate::types::{LogLine, LogStream};

pub const LOG_TAIL: &str = "1000";
pub const LOG_BATCH_LINES: usize = 200;
pub const LOG_BATCH_WINDOW: Duration = Duration::from_millis(16);
pub const LOG_CHANNEL_CAPACITY: usize = 1024;
pub const LOG_RING_MAX: usize = 20_000;

pub fn parse_docker_log_text(text: &str) -> (Option<i64>, String) {
    let Some((prefix, rest)) = text.split_once(' ') else {
        return (None, text.to_string());
    };
    match DateTime::parse_from_rfc3339(prefix) {
        Ok(dt) => (Some(dt.timestamp_millis()), rest.to_string()),
        Err(_) => (None, text.to_string()),
    }
}

pub fn should_flush(buffered_lines: usize, elapsed: Duration) -> bool {
    buffered_lines >= LOG_BATCH_LINES || elapsed >= LOG_BATCH_WINDOW
}

#[derive(Default)]
pub struct LogSeq {
    next: u64,
}

impl LogSeq {
    pub fn next_line(
        &mut self,
        stream: LogStream,
        timestamp_unix_ms: Option<i64>,
        raw: String,
    ) -> LogLine {
        self.next += 1;
        LogLine {
            seq: self.next,
            stream,
            timestamp_unix_ms,
            raw,
        }
    }
}

pub fn push_ring(lines: &mut Vec<LogLine>, incoming: Vec<LogLine>) {
    lines.extend(incoming);
    if lines.len() > LOG_RING_MAX {
        let overflow = lines.len() - LOG_RING_MAX;
        lines.drain(0..overflow);
    }
}

pub struct BatchQueue {
    cap: usize,
    q: VecDeque<Vec<LogLine>>,
}

impl BatchQueue {
    pub fn new(cap: usize) -> Self {
        Self {
            cap,
            q: VecDeque::new(),
        }
    }

    pub fn push_batch(&mut self, lines: Vec<LogLine>) -> u64 {
        if self.cap == 0 {
            return lines.len() as u64;
        }
        let mut omitted = 0u64;
        while self.q.len() >= self.cap {
            omitted += self.q.pop_front().map(|b| b.len() as u64).unwrap_or(0);
        }
        self.q.push_back(lines);
        omitted
    }

    pub fn pop_batch(&mut self) -> Option<Vec<LogLine>> {
        self.q.pop_front()
    }
}
```

`pub mod logs;` in `lib.rs`.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core log_unit_tests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core
git commit -m "feat: parse docker log lines and apply batch backpressure"
```

---

### Task 7: Event type mapping and invalidate debounce

**Files:**
- Create: `crates/dockbolt-core/src/events.rs`
- Modify: `crates/dockbolt-core/src/lib.rs`

**Interfaces:**
- Consumes: `ResourceKind`
- Produces:
  - `pub fn resource_from_docker_type(ty: &str) -> Option<ResourceKind>`
  - `pub struct InvalidateDebouncer` with `on_event(&mut self, kind, now_ms: u64) -> Vec<ResourceKind>` emitting kinds whose last emit was ≥ 100ms ago; coalescing same kind within 100ms into one later flush via `flush_due(&mut self, now_ms) -> Vec<ResourceKind>`

Use two functions to keep tests deterministic:

```rust
pub const INVALIDATE_DEBOUNCE_MS: u64 = 100;

pub fn resource_from_docker_type(ty: &str) -> Option<ResourceKind> {
    match ty {
        "container" => Some(ResourceKind::Containers),
        "image" => Some(ResourceKind::Images),
        "volume" => Some(ResourceKind::Volumes),
        _ => None,
    }
}
```

`InvalidateDebouncer`: HashSet pending + last_emit map. `note(kind, now_ms)` adds pending. `take_ready(now_ms)` returns kinds in pending whose `now_ms - last_scheduled >= 100` OR first event immediately? Spec: "同一 resource は 100ms 以内にまとめて 1 回". First event should schedule; emit after 100ms, not immediately. Tests:

- two container events at t=0 and t=50 → take_ready(50) empty, take_ready(100) `[Containers]` once
- container + image at t=0 → take_ready(100) both

- [ ] **Step 1: Write the failing test**

```rust
mod events;

#[cfg(test)]
mod event_tests {
    use crate::events::{resource_from_docker_type, InvalidateDebouncer};
    use crate::ResourceKind;

    #[test]
    fn maps_docker_types() {
        assert_eq!(
            resource_from_docker_type("container"),
            Some(ResourceKind::Containers)
        );
        assert_eq!(resource_from_docker_type("image"), Some(ResourceKind::Images));
        assert_eq!(resource_from_docker_type("volume"), Some(ResourceKind::Volumes));
        assert_eq!(resource_from_docker_type("network"), None);
    }

    #[test]
    fn debounce_coalesces_same_kind() {
        let mut d = InvalidateDebouncer::new();
        d.note(ResourceKind::Containers, 0);
        d.note(ResourceKind::Containers, 50);
        assert!(d.take_ready(50).is_empty());
        let ready = d.take_ready(100);
        assert_eq!(ready, vec![ResourceKind::Containers]);
        assert!(d.take_ready(100).is_empty());
    }

    #[test]
    fn debounce_separates_kinds() {
        let mut d = InvalidateDebouncer::new();
        d.note(ResourceKind::Containers, 0);
        d.note(ResourceKind::Images, 0);
        let mut ready = d.take_ready(100);
        ready.sort_by_key(|k| k.as_str());
        assert_eq!(
            ready,
            vec![ResourceKind::Containers, ResourceKind::Images]
        );
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core event_tests`
Expected: FAIL (`mod events` missing)

- [ ] **Step 3: Write minimal implementation**

```rust
use std::collections::{HashMap, HashSet};

use crate::types::ResourceKind;

pub const INVALIDATE_DEBOUNCE_MS: u64 = 100;

pub fn resource_from_docker_type(ty: &str) -> Option<ResourceKind> {
    match ty {
        "container" => Some(ResourceKind::Containers),
        "image" => Some(ResourceKind::Images),
        "volume" => Some(ResourceKind::Volumes),
        _ => None,
    }
}

pub struct InvalidateDebouncer {
    pending: HashSet<ResourceKind>,
    first_ms: HashMap<ResourceKind, u64>,
}

impl InvalidateDebouncer {
    pub fn new() -> Self {
        Self {
            pending: HashSet::new(),
            first_ms: HashMap::new(),
        }
    }

    pub fn note(&mut self, kind: ResourceKind, now_ms: u64) {
        self.pending.insert(kind);
        self.first_ms.entry(kind).or_insert(now_ms);
    }

    pub fn take_ready(&mut self, now_ms: u64) -> Vec<ResourceKind> {
        let mut ready = Vec::new();
        let kinds: Vec<_> = self.pending.iter().copied().collect();
        for kind in kinds {
            if let Some(first) = self.first_ms.get(&kind) {
                if now_ms.saturating_sub(*first) >= INVALIDATE_DEBOUNCE_MS {
                    ready.push(kind);
                    self.pending.remove(&kind);
                    self.first_ms.remove(&kind);
                }
            }
        }
        ready
    }
}

impl Default for InvalidateDebouncer {
    fn default() -> Self {
        Self::new()
    }
}
```

Need `ResourceKind` to be `Hash + Copy` — add `Hash` to the derive in `types.rs` in this task (modify `types.rs`).

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core event_tests`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core
git commit -m "feat: map docker events and debounce list invalidation"
```

---

### Task 8: Bollard DockerPort adapter

**Files:**
- Create: `crates/dockbolt-core/src/bollard_client.rs`
- Modify: `crates/dockbolt-core/src/lib.rs`
- Modify: `crates/dockbolt-core/src/error.rs` (add `From` mapping helper)

**Interfaces:**
- Consumes: `DockerPort`, DTOs, `LOG_TAIL`
- Produces:
  - `pub struct BollardDocker { docker: bollard::Docker, endpoint: String }`
  - `pub fn connect_unix(socket_path: &str) -> Result<BollardDocker, DockboltError>`
  - `pub fn map_bollard_error(err: bollard::errors::Error) -> DockboltError`
  - Implements `DockerPort`
  - logs: `LogsOptions { follow: true, stdout: true, stderr: true, timestamps: true, tail: LOG_TAIL.to_string(), ..Default::default() }`
  - `remove_container` uses caller's `force`
  - `remove_image` uses `RemoveImageOptions { force: false, noprune: false, .. }`
  - `remove_volume` uses `force: false` (`RemoveVolumeOptions { force: false }`)
  - events: map `event.typ` through `resource_from_docker_type`, skip unknown
  - ping timeout: callers wrap `version()` with `tokio::time::timeout(Duration::from_millis(100), ...)` in `pub async fn ping(docker: &dyn DockerPort) -> Result<String, DockboltError>`

Add `pub async fn ping(docker: &dyn DockerPort) -> Result<String, DockboltError>` in `client.rs`:

```rust
pub async fn ping(docker: &dyn DockerPort) -> Result<String, DockboltError> {
    match tokio::time::timeout(std::time::Duration::from_millis(100), docker.version()).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(DockboltError::Timeout),
    }
}
```

- [ ] **Step 1: Write the failing test**

Add tests for `map_bollard_error` using constructed I/O-like strings if bollard errors are hard to build. Implement a unit function:

```rust
pub fn map_status_and_message(status: Option<u16>, message: &str) -> DockboltError {
    let lower = message.to_lowercase();
    if lower.contains("permission denied") || lower.contains("eacces") {
        return DockboltError::PermissionDenied;
    }
    match status {
        Some(404) => DockboltError::NotFound(message.to_string()),
        Some(409) if lower.contains("in use") || lower.contains("being used") || lower.contains("conflict") => {
            DockboltError::InUse {
                summary: message.to_string(),
            }
        }
        Some(409) => DockboltError::Conflict(message.to_string()),
        _ => DockboltError::EngineUnreachable(message.to_string()),
    }
}
```

Tests:

```rust
#[test]
fn maps_permission() {
    assert_eq!(
        map_status_and_message(None, "permission denied").code(),
        "permission_denied"
    );
}

#[test]
fn maps_in_use() {
    assert_eq!(
        map_status_and_message(Some(409), "volume is in use").code(),
        "in_use"
    );
}

#[test]
fn maps_404() {
    assert_eq!(
        map_status_and_message(Some(404), "no such container").code(),
        "not_found"
    );
}
```

Timeout test for `ping` with a mock whose `version` sleeps 200ms.

Put mock sleep DockerPort in `client.rs` tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt-core maps_in_use`
Expected: FAIL (function missing)

- [ ] **Step 3: Write minimal implementation**

Implement `map_status_and_message` in `error.rs`.

Implement `ping` in `client.rs` with the timeout test mock (full DockerPort impl, same as Task 4 mock, `version` = `tokio::time::sleep(200ms).await; Ok("1".into())`).

Implement `BollardDocker` in `bollard_client.rs`:

```rust
use std::pin::Pin;

use async_trait::async_trait;
use bollard::container::{ListContainersOptions, LogsOptions, RemoveContainerOptions};
use bollard::image::{ListImagesOptions, RemoveImageOptions};
use bollard::volume::{ListVolumesOptions, RemoveVolumeOptions};
use bollard::Docker;
use futures::{Stream, StreamExt};

use crate::client::DockerPort;
use crate::containers::normalize_container_name;
use crate::error::{map_status_and_message, DockboltError};
use crate::events::resource_from_docker_type;
use crate::logs::{parse_docker_log_text, LOG_TAIL};
use crate::types::{
    ContainerRow, EngineEvent, ImageRow, LogStream, RawLogChunk, VolumeRow,
};

pub struct BollardDocker {
    docker: Docker,
    pub endpoint: String,
}

pub fn connect_unix(socket_path: &str) -> Result<BollardDocker, DockboltError> {
    let addr = if socket_path.starts_with("unix://") {
        socket_path.to_string()
    } else {
        format!("unix://{socket_path}")
    };
    let docker = Docker::connect_with_unix(&addr, 120, bollard::API_DEFAULT_VERSION)
        .map_err(|e| map_bollard_error(e))?;
    Ok(BollardDocker {
        docker,
        endpoint: addr,
    })
}

pub fn map_bollard_error(err: bollard::errors::Error) -> DockboltError {
    let msg = err.to_string();
    let status = match &err {
        bollard::errors::Error::DockerResponseServerError { status_code, .. } => {
            Some(*status_code)
        }
        _ => None,
    };
    map_status_and_message(status, &msg)
}

fn map_log_output(output: bollard::container::LogOutput) -> RawLogChunk {
    let (stream, message) = match output {
        bollard::container::LogOutput::StdErr { message } => (LogStream::Stderr, message),
        bollard::container::LogOutput::StdOut { message } => (LogStream::Stdout, message),
        bollard::container::LogOutput::Console { message } => (LogStream::Stdout, message),
        bollard::container::LogOutput::StdIn { message } => (LogStream::Stdout, message),
    };
    RawLogChunk {
        stream,
        text: String::from_utf8_lossy(&message).trim_end_matches('\n').to_string(),
    }
}

#[async_trait]
impl DockerPort for BollardDocker {
    async fn version(&self) -> Result<String, DockboltError> {
        let v = self.docker.version().await.map_err(map_bollard_error)?;
        Ok(v.api_version.unwrap_or_else(|| "unknown".into()))
    }

    async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
        let opts = ListContainersOptions::<String> {
            all: true,
            ..Default::default()
        };
        let list = self
            .docker
            .list_containers(Some(opts))
            .await
            .map_err(map_bollard_error)?;
        Ok(list
            .into_iter()
            .map(|c| {
                let id = c.id.clone().unwrap_or_default();
                let names = c.names.unwrap_or_default();
                let state = c.state.clone().unwrap_or_default();
                ContainerRow {
                    name: normalize_container_name(&names, &id),
                    image: c.image.unwrap_or_default(),
                    running: state.eq_ignore_ascii_case("running"),
                    state,
                    created_unix: c.created.unwrap_or(0),
                    id,
                }
            })
            .collect())
    }

    async fn remove_container(&self, id: &str, force: bool) -> Result<(), DockboltError> {
        self.docker
            .remove_container(
                id,
                Some(RemoveContainerOptions {
                    force,
                    ..Default::default()
                }),
            )
            .await
            .map_err(map_bollard_error)
    }

    async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError> {
        let list = self
            .docker
            .list_images(Some(ListImagesOptions::<String> {
                all: true,
                ..Default::default()
            }))
            .await
            .map_err(map_bollard_error)?;
        Ok(list
            .into_iter()
            .map(|img| ImageRow {
                id: img.id,
                tags: img.repo_tags,
                size_bytes: img.size as u64,
                created_unix: img.created,
            })
            .collect())
    }

    async fn remove_image(&self, id: &str) -> Result<(), DockboltError> {
        self.docker
            .remove_image(
                id,
                Some(RemoveImageOptions {
                    force: false,
                    noprune: false,
                    ..Default::default()
                }),
                None,
            )
            .await
            .map(|_| ())
            .map_err(map_bollard_error)
    }

    async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError> {
        let resp = self
            .docker
            .list_volumes(None::<ListVolumesOptions<String>>)
            .await
            .map_err(map_bollard_error)?;
        Ok(resp
            .volumes
            .unwrap_or_default()
            .into_iter()
            .map(|v| VolumeRow {
                name: v.name,
                driver: v.driver,
            })
            .collect())
    }

    async fn remove_volume(&self, name: &str) -> Result<(), DockboltError> {
        self.docker
            .remove_volume(
                name,
                Some(RemoveVolumeOptions { force: false }),
            )
            .await
            .map_err(map_bollard_error)
    }

    fn logs(
        &self,
        container_id: &str,
    ) -> Pin<Box<dyn Stream<Item = Result<RawLogChunk, DockboltError>> + Send>> {
        let id = container_id.to_string();
        let docker = self.docker.clone();
        Box::pin(async_stream::stream! {
            let opts = LogsOptions::<String> {
                follow: true,
                stdout: true,
                stderr: true,
                timestamps: true,
                tail: LOG_TAIL.to_string(),
                ..Default::default()
            };
            let mut s = docker.logs(&id, Some(opts));
            while let Some(item) = s.next().await {
                match item {
                    Ok(out) => {
                        let mut chunk = map_log_output(out);
                        let (ts, raw) = parse_docker_log_text(&chunk.text);
                        if ts.is_some() {
                            chunk.text = raw;
                        }
                        // timestamp is applied later when building LogLine in Tauri; keep parse here by encoding in text only if we store ts on RawLogChunk
                        yield Ok(RawLogChunk { stream: chunk.stream, text: chunk.text });
                    }
                    Err(e) => yield Err(map_bollard_error(e)),
                }
            }
        })
    }

    fn events(
        &self,
    ) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>> {
        let docker = self.docker.clone();
        Box::pin(async_stream::stream! {
            let mut s = docker.events(None::<bollard::system::EventsOptions<String>>);
            while let Some(item) = s.next().await {
                match item {
                    Ok(ev) => {
                        if let Some(resource) = resource_from_docker_type(&ev.typ) {
                            yield Ok(EngineEvent { resource });
                        }
                    }
                    Err(e) => yield Err(map_bollard_error(e)),
                }
            }
        })
    }
}
```

Add `async-stream = "0.3"` to `crates/dockbolt-core/Cargo.toml`.

Fix logs: extend `RawLogChunk` with `timestamp_unix_ms: Option<i64>` in `types.rs` and set it in `map_log_output` path after `parse_docker_log_text`. Update Task 2 type — this task modifies `RawLogChunk`:

```rust
pub struct RawLogChunk {
    pub stream: LogStream,
    pub text: String,
    pub timestamp_unix_ms: Option<i64>,
}
```

Any `RawLogChunk { stream, text }` literals in tests must add `timestamp_unix_ms: None`. Update those in this task if the compiler fails.

`parse_docker_log_text` in the stream:

```rust
let (ts, raw) = parse_docker_log_text(&text);
yield Ok(RawLogChunk { stream, text: raw, timestamp_unix_ms: ts });
```

If `bollard::errors::Error::DockerResponseServerError` variant name differs in 0.18, match on `status_code` via string parse: if `msg` contains `status code: 409`. Keep `map_status_and_message` as the tested surface; `map_bollard_error` extracts what it can.

Add `pub mod bollard_client;`

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core`
Expected: PASS. If Bollard type names fail to compile, fix to 0.18 docs (`ev.typ` may be `ev.type_` or `actor`). Adjust compile errors without changing tests.

- [ ] **Step 5: Commit**

```bash
git add crates/dockbolt-core
git commit -m "feat: connect to docker engine with bollard"
```

---

### Task 9: Tauri shell, AppState, connection IPC

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/state.rs`
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/App.tsx` (placeholder until Task 11)
- Modify: root `Cargo.toml` members to include `src-tauri`

**Interfaces:**
- Consumes: `engine_specs`, `candidate_from_probe`, `select_engine_id`, `connect_unix`, `ping`, `ConnectionView`
- Produces Tauri commands:
  - `list_engines() -> Vec<EngineCandidate>`
  - `connect_engine(engine_id: String) -> ConnectionView`
  - `connection_status() -> ConnectionView`
  - Events: `connection://changed`
- Persist `src-tauri` config dir file `engine.json` as `{"selected_engine_id":"..."}`
- Ping timeout 100ms already in `ping`

`AppState`:

```rust
pub struct AppState {
    pub inner: tokio::sync::Mutex<Inner>,
}

pub struct Inner {
    pub connection: ConnectionView,
    pub docker: Option<Arc<BollardDocker>>,
    pub selected_engine_id: Option<String>,
    pub log_abort: Option<tokio::sync::oneshot::Sender<()>>,
    pub events_abort: Option<tokio::sync::oneshot::Sender<()>>,
}
```

Probe: for each spec, `std::path::Path::new(&spec.socket_path).exists()`, then `connect_unix` + `ping`.

On `connect_engine`: abort logs+events senders, connect, spawn events task (Task 10 can no-op spawn until lists exist — spawn here calling `resources://invalidate`).

Home dir: `dirs::home_dir()` — add `dirs = "5"` to src-tauri.

- [ ] **Step 1: Write the failing test**

Core already has selection tests. Add `src-tauri` unit test module in `state.rs` for JSON roundtrip:

```rust
#[derive(serde::Serialize, serde::Deserialize)]
pub struct EngineFile {
    pub selected_engine_id: String,
}

#[test]
fn engine_file_roundtrip() {
    let raw = serde_json::to_string(&EngineFile {
        selected_engine_id: "orbstack".into(),
    })
    .unwrap();
    let parsed: EngineFile = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed.selected_engine_id, "orbstack");
}
```

Put `EngineFile` in `state.rs`. Create the `dockbolt` Tauri package and implement commands in Step 3 so `cargo test -p dockbolt` compiles.

Package name `dockbolt` in `src-tauri/Cargo.toml`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p dockbolt engine_file_roundtrip`
Expected: FAIL (package missing)

- [ ] **Step 3: Write minimal implementation**

Root workspace:

```toml
[workspace]
resolver = "2"
members = ["crates/dockbolt-core", "src-tauri"]
```

`src-tauri/Cargo.toml`:

```toml
[package]
name = "dockbolt"
version = "0.1.0"
edition = "2021"

[lib]
name = "dockbolt_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
dockbolt-core = { path = "../crates/dockbolt-core" }
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time"] }
dirs = "5"
tracing = "0.1"
uuid = { version = "1", features = ["v4"] }

[dev-dependencies]
serde_json = "1"
```

`src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new()).expect("tauri build");
}
```

If `try_build` API differs, use `tauri_build::build();`.

`src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "DockBolt",
  "version": "0.1.0",
  "identifier": "dev.dockbolt.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "DockBolt",
        "width": 1100,
        "height": 720
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all"
  }
}
```

`src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default"
  ]
}
```

`src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dockbolt_lib::run();
}
```

Implement `state.rs` + commands `list_engines`, `connect_engine`, `connection_status` in `lib.rs`. On startup `run()`: `Builder::default().manage(AppState::new()).setup(|app| { /* load engine.json from app.path().app_config_dir(); list+select; connect } ).invoke_handler(tauri::generate_handler![list_engines, connect_engine, connection_status, list_containers, list_images, list_volumes, delete_container, delete_image, delete_volume, refresh, start_logs, stop_logs])`.

List/delete/log commands can live in this task as thin wrappers so the app compiles (implement fully here, not later stubs).

`list_containers`: lock state, `docker.list_containers()`, `sort_containers`, return. If no docker, `Err` with disconnected.

`delete_container`: find row by id from a fresh list (or require frontend to pass running flag — spec input is `{ id }`). Fetch list, find id, `containers::delete_container`.

`start_logs`: uuid session, abort previous, spawn task: read `docker.logs(id)`, accumulate lines, flush with `should_flush`, `app.emit("logs://batch", Payload { session_id, lines, omitted })`.

`stop_logs`: abort.

Events spawn on connect: `InvalidateDebouncer`, on `EngineEvent` note + `take_ready`, emit `resources://invalidate` `{ resource: kind.as_str() }`. Reconnect loop 200,400,800,... cap 5000ms on stream end.

`refresh(resource)`: `"containers"|"images"|"volumes"|"all"`.

IPC error: `#[derive(serde::Serialize)] struct IpcError { code: String, message: String }` with `impl From<DockboltError>`. Commands return `Result<T, IpcError>`.

Placeholder frontend so `npm run build` works — add in this task:

`package.json`:

```json
{
  "name": "dockbolt",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run"
  },
  "dependencies": {
    "@tanstack/react-virtual": "^3.13.0",
    "@tauri-apps/api": "^2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^6.0.3",
    "vitest": "^2.1.8"
  }
}
```

`vite.config.ts` port 1420, `server.strictPort: true`.

`src/App.tsx` return `<div>DockBolt</div>` until Task 10.

Add `src-tauri` to `.gitignore` for `target` — root `.gitignore`:

```
/target
/src-tauri/target
/node_modules
/dist
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cargo test -p dockbolt-core && cargo test -p dockbolt`
Expected: PASS. `npm install` then `npx vitest run` may have zero tests yet (exit 1). Add `src/smoke.test.ts`: `import { expect, test } from "vitest"; test("ok", () => expect(true).toBe(true));`

Run: `npm install && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml src-tauri package.json package-lock.json vite.config.ts tsconfig.json tsconfig.node.json index.html src .gitignore
git commit -m "feat: add Tauri IPC for engine connection and docker commands"
```

---

### Task 10: React chrome, resource screens, confirm delete

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/lib/format.ts`
- Create: `src/stores/connection.ts`
- Create: `src/stores/containers.ts`
- Create: `src/stores/images.ts`
- Create: `src/stores/volumes.ts`
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/StatusBar.tsx`
- Create: `src/components/ConfirmDialog.tsx`
- Create: `src/components/VirtualTable.tsx`
- Create: `src/screens/Containers.tsx`
- Create: `src/screens/Images.tsx`
- Create: `src/screens/Volumes.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes invoke names from spec
- Produces routes `/`, `/images`, `/volumes`
- Empty copy: `No containers`, `No images`, `No volumes`
- Delete copy from spec section 6.2
- Status bar shows Connecting / Connected name / Disconnected message + Retry
- Engine menu lists `EngineCandidate[]`, calls `connect_engine`

`src/lib/tauri.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ContainerRow = {
  id: string;
  name: string;
  image: string;
  state: string;
  running: boolean;
  created_unix: number;
};
export type ImageRow = {
  id: string;
  tags: string[];
  size_bytes: number;
  created_unix: number;
};
export type VolumeRow = { name: string; driver: string };
export type EngineCandidate = {
  engine_id: string;
  name: string;
  endpoint: string;
  available: boolean;
  unavailable_reason?: string;
};
export type ConnectionView =
  | { status: "connecting" }
  | {
      status: "connected";
      engine_id: string;
      name: string;
      endpoint: string;
      api_version: string;
    }
  | { status: "disconnected"; reason: string; message: string };

export const api = {
  listEngines: () => invoke<EngineCandidate[]>("list_engines"),
  connectEngine: (engine_id: string) =>
    invoke<ConnectionView>("connect_engine", { engineId: engine_id }),
  connectionStatus: () => invoke<ConnectionView>("connection_status"),
  listContainers: () => invoke<ContainerRow[]>("list_containers"),
  listImages: () => invoke<ImageRow[]>("list_images"),
  listVolumes: () => invoke<VolumeRow[]>("list_volumes"),
  deleteContainer: (id: string) => invoke("delete_container", { id }),
  deleteImage: (id: string) => invoke("delete_image", { id }),
  deleteVolume: (name: string) => invoke("delete_volume", { name }),
  refresh: (resource: "containers" | "images" | "volumes" | "all") =>
    invoke("refresh", { resource }),
  startLogs: (container_id: string) =>
    invoke<{ session_id: string }>("start_logs", { containerId: container_id }),
  stopLogs: (session_id: string) => invoke("stop_logs", { sessionId: session_id }),
};

export function listenConnection(cb: (v: ConnectionView) => void): Promise<UnlistenFn> {
  return listen<ConnectionView>("connection://changed", (e) => cb(e.payload));
}

export function listenInvalidate(
  cb: (resource: "containers" | "images" | "volumes") => void,
): Promise<UnlistenFn> {
  return listen<{ resource: "containers" | "images" | "volumes" }>(
    "resources://invalidate",
    (e) => cb(e.payload.resource),
  );
}
```

Note: Tauri 2 converts rust `engine_id` to JS `engineId` in invoke args if using serde rename. **Use serde `rename_all = "snake_case"` on command args structs** so JS can pass `{ engine_id }` consistently. Align `api.connectEngine` to `invoke("connect_engine", { engine_id })` and define

```rust
#[derive(Deserialize)]
struct ConnectArg { engine_id: String }
```

Do not camelCase in JS.

`format.ts`: `shortId(id) => id.replace("sha256:", "").slice(0, 12)`, `fmtBytes`, `fmtTime(unix)`.

ConfirmDialog props: `{ title, body, confirmLabel: "Delete", onConfirm, onCancel }`.

VirtualTable: `rowHeight=32`, `count`, `rowRenderer`.

App listen invalidate → corresponding store `reload()`.

Disconnected: still render screens but table shows `message` and Retry calling `list_engines` + `connect_engine` with `select` first available.

- [ ] **Step 1: Write the failing test**

`src/format.test.ts`:

```ts
import { expect, test } from "vitest";
import { shortId } from "./lib/format";

test("short id strips sha and truncates", () => {
  expect(shortId("sha256:0123456789abcdef")).toBe("0123456789ab");
});
```

Do not create `format.ts` yet.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/format.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

Implement `format.ts` and all screens listed. Dark dense CSS in `styles.css` (system font, no animation except modal display). Sidebar links. Containers row click selects; Delete enabled when selected. Logs button on selected running or any container → navigate `/containers/:id/logs` (screen in Task 11; for now `navigate` can land on a `div` Logs placeholder).

Wire `main.tsx` with `BrowserRouter`.

Tauri arg structs must be snake_case to match `api` above.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run && cargo test -p dockbolt-core`
Expected: PASS

Manual: `npm run tauri dev` lists containers when Docker socket works.

- [ ] **Step 5: Commit**

```bash
git add src src-tauri
git commit -m "feat: add resource list screens and confirm delete"
```

---

### Task 11: Logs screen, filters, ring buffer store

**Files:**
- Create: `src/screens/Logs.tsx`
- Create: `src/stores/logs.ts`
- Create: `src/lib/logFilter.ts`
- Create: `src/logFilter.test.ts`
- Create: `src/stores/logs.test.ts`
- Modify: `src/lib/tauri.ts` (listen `logs://batch`, `logs://ended`)
- Modify: `src/App.tsx` route `/containers/:id/logs`

**Interfaces:**
- Consumes: `LogLine`, session_id
- Produces:
  - `filterLines(lines, query, stream: "all"|"stdout"|"stderr")`
  - store `pushBatch(lines, omitted)` caps 20000
  - Clear: query `""`, stream `all`, lines unchanged
  - Header: container name + running dot, `Skipped {n} lines` if omitted>0
  - Search placeholder `Search logs...`, select `All`, button `Clear`
  - `HH:MM:SS` from `timestamp_unix_ms` local
  - stderr rows use a distinct CSS class (color), no INFO/ERROR parsing

- [ ] **Step 1: Write the failing test**

`src/logFilter.test.ts`:

```ts
import { expect, test } from "vitest";
import { filterLines } from "./lib/logFilter";
import type { LogLine } from "./lib/tauri";

const lines: LogLine[] = [
  { seq: 1, stream: "stdout", raw: "Hello World" },
  { seq: 2, stream: "stderr", raw: "boom" },
];

test("case insensitive substring", () => {
  expect(filterLines(lines, "hello", "all").map((l) => l.seq)).toEqual([1]);
});

test("stdout filter hides stderr", () => {
  expect(filterLines(lines, "", "stdout").map((l) => l.seq)).toEqual([1]);
});

test("empty query keeps all for all streams", () => {
  expect(filterLines(lines, "", "all")).toHaveLength(2);
});
```

`src/stores/logs.test.ts` — extract pure function in `logs.ts`:

```ts
export function applyBatch(
  current: LogLine[],
  incoming: LogLine[],
  max = 20000,
): LogLine[] {
  const next = current.concat(incoming);
  return next.length > max ? next.slice(next.length - max) : next;
}
```

```ts
import { expect, test } from "vitest";
import { applyBatch } from "./stores/logs";
import type { LogLine } from "./lib/tauri";

test("drops oldest past 20000", () => {
  const current: LogLine[] = Array.from({ length: 19998 }, (_, i) => ({
    seq: i,
    stream: "stdout" as const,
    raw: "x",
  }));
  const incoming: LogLine[] = [
    { seq: 19998, stream: "stdout", raw: "a" },
    { seq: 19999, stream: "stdout", raw: "b" },
    { seq: 20000, stream: "stdout", raw: "c" },
  ];
  const out = applyBatch(current, incoming, 20000);
  expect(out).toHaveLength(20000);
  expect(out[0].seq).toBe(1);
  expect(out[out.length - 1].seq).toBe(20000);
});
```

Wait: current 19998 lines seq 0..19997, incoming 3 lines → total 20001, slice last 20000 → first seq is 1. Yes.

Clear behavior test in logFilter or store:

```ts
test("clear resets query and stream not lines", () => {
  const cleared = { query: "", streamFilter: "all" as const };
  expect(cleared.query).toBe("");
});
```

Skip tautology. Implement Clear in UI only; filter tests cover empty query.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/logFilter.test.ts src/stores/logs.test.ts`
Expected: FAIL (modules missing)

- [ ] **Step 3: Write minimal implementation**

`logFilter.ts`:

```ts
import type { LogLine } from "./tauri";

export type StreamFilter = "all" | "stdout" | "stderr";

export function filterLines(
  lines: LogLine[],
  query: string,
  stream: StreamFilter,
): LogLine[] {
  const q = query.trim().toLocaleLowerCase();
  return lines.filter((l) => {
    if (stream !== "all" && l.stream !== stream) return false;
    if (!q) return true;
    return l.raw.toLocaleLowerCase().includes(q);
  });
}
```

Zustand store holds `lines`, `query`, `streamFilter`, `omitted`, `sessionId`, `containerId`, `endedReason`. `start` invokes `start_logs`, listens batches. On unmount `stop_logs`.

Virtualize filtered array.

tty stderr limitation is backend; UI still offers stderr filter.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: stream container logs with substring and stream filters"
```

---

### Task 12: Engine switcher persistence and event-driven reload

**Files:**
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src-tauri/src/lib.rs` / `state.rs` if persistence gaps remain
- Modify: `src/stores/connection.ts`

**Interfaces:**
- Consumes: `engine.json` via backend (already Task 9)
- Produces: status bar select of engines; switching clears three list stores then reloads; logs `stop_logs` on switch (backend already aborts)

- [ ] **Step 1: Write the failing test**

Frontend helper `src/lib/engineSelect.ts`:

```ts
export function nextEngineId(
  saved: string | undefined,
  candidates: { engine_id: string; available: boolean }[],
): string | undefined {
  if (saved && candidates.some((c) => c.engine_id === saved && c.available)) {
    return saved;
  }
  return candidates.find((c) => c.available)?.engine_id;
}
```

Test file `src/engineSelect.test.ts` matching Task 3 cases (unix saved dead → orbstack).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engineSelect.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Implement `nextEngineId`. StatusBar: `<select>` of candidates, disabled option if `!available`, onChange `connect_engine`. Retry uses `nextEngineId(undefined, engines)` if disconnected.

App on `connection://changed` to disconnected: empty container/image/volume arrays.

Verify backend writes `engine.json` after successful connect (read/write in `connect_engine`). Invalid JSON treated as missing.

Backoff on events: 200, 400, 800, 1600, 3200, 5000 ms then stay at 5000. After reconnect success, emit invalidate for all three resources (or `refresh` all from rust).

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run && cargo test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src src-tauri
git commit -m "feat: switch docker engines from the status bar"
```

---

## Self-review

**Spec coverage**

| Spec section | Task |
|---|---|
| Architecture / crates | 1, 8, 9 |
| IPC names | 9, 10, 11 |
| Engine detect + persist + switch | 3, 9, 12 |
| Container list/sort/force delete | 4, 10 |
| Image/volume list/delete InUse | 5, 8, 10 |
| Events debounce + no polling | 7, 9, 12 |
| Logs tail 1000 follow batch omit filter | 6, 8, 11 |
| Errors + permission copy | 2, 8, 10 |
| UI routes, empty strings, English | 10, 11 |
| Tests without daemon | 2–7, 11, 12 |
| Out of scope (Compose, Windows, …) | not scheduled |

**Placeholder scan:** none remaining in tasks. Bollard event field names may need a compile fix in Task 8 without changing behavior.

**Type consistency:** `engine_id`, `session_id`, `ResourceKind::as_str()` values `containers|images|volumes`, log `stream` `stdout|stderr`, connection `status` `connecting|connected|disconnected`, invoke argument structs snake_case.
