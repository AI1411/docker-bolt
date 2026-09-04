use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use dockbolt_core::bollard_client::{connect_unix, BollardDocker};
use dockbolt_core::client::{ping, DockerPort};
use dockbolt_core::containers::sort_containers;
use dockbolt_core::engine::{candidate_from_probe, engine_specs, select_engine_id};
use dockbolt_core::events::{
    classify_events_poll, EventsSubscribe, InvalidateDebouncer, INVALIDATE_DEBOUNCE_MS,
};
use dockbolt_core::images::{classify_images, sort_images};
use dockbolt_core::logs::{
    should_flush, BatchQueue, LogSeq, LOG_BATCH_WINDOW, LOG_CHANNEL_CAPACITY,
};
use dockbolt_core::networks::sort_networks;
use dockbolt_core::volumes::list_classified_volumes;
use dockbolt_core::{
    ComposeProjectRow, ConnectionView, ContainerInspect, ContainerRow, DockboltError,
    EngineCandidate, EngineEvent, ImageRow, LogLine, NetworkRow, PrunePreview, PruneReport,
    VolumeRow,
};
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

mod state;

pub use state::{AppState, EngineFile, Inner};

#[derive(Debug, Clone, Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

impl From<DockboltError> for IpcError {
    fn from(err: DockboltError) -> Self {
        Self {
            code: err.code().to_string(),
            message: err.message(),
        }
    }
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for IpcError {}

fn ipc_internal(message: impl ToString) -> IpcError {
    IpcError {
        code: "internal".into(),
        message: message.to_string(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectArg {
    pub engine_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct IdArg {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct NameArg {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ProjectArg {
    pub project: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PathArg {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct PickComposeReply {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RefreshArg {
    pub resource: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StartLogsArg {
    pub container_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct StopLogsArg {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OkReply {
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionReply {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct InvalidatePayload {
    resource: String,
}

#[derive(Debug, Clone, Serialize)]
struct LogBatchPayload {
    session_id: String,
    lines: Vec<LogLine>,
    omitted: u64,
}

#[derive(Debug, Clone, Serialize)]
struct LogEndedPayload {
    session_id: String,
    reason: String,
}

fn home_dir_string() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn engine_config_path(app: &AppHandle) -> Result<std::path::PathBuf, IpcError> {
    let dir = app.path().app_config_dir().map_err(ipc_internal)?;
    Ok(state::engine_json_path(dir))
}

async fn probe_engines() -> Vec<EngineCandidate> {
    let specs = engine_specs(&home_dir_string());
    let mut out = Vec::with_capacity(specs.len());
    for spec in specs {
        let path_exists = std::path::Path::new(&spec.socket_path).exists();
        let ping_result = if path_exists {
            match connect_unix(&spec.socket_path) {
                Ok(docker) => ping(&docker).await.map(|_| ()),
                Err(err) => Err(err),
            }
        } else {
            Ok(())
        };
        out.push(candidate_from_probe(&spec, path_exists, ping_result));
    }
    out
}

fn disconnected_from_candidates(candidates: &[EngineCandidate]) -> ConnectionView {
    let permission = candidates
        .iter()
        .find(|c| c.unavailable_reason.as_deref() == Some(DockboltError::PermissionDenied.code()));
    if permission.is_some() {
        ConnectionView::Disconnected {
            reason: DockboltError::PermissionDenied.code().to_string(),
            message: DockboltError::PermissionDenied.message(),
        }
    } else {
        ConnectionView::Disconnected {
            reason: DockboltError::SocketNotFound.code().to_string(),
            message: DockboltError::SocketNotFound.message(),
        }
    }
}

fn disconnected_err(inner: &Inner) -> IpcError {
    match &inner.connection {
        ConnectionView::Disconnected { reason, message } => IpcError {
            code: reason.clone(),
            message: message.clone(),
        },
        _ => IpcError {
            code: DockboltError::EngineUnreachable("not connected".into())
                .code()
                .to_string(),
            message: "Not connected to a Docker engine".into(),
        },
    }
}

async fn docker_from_state(state: &AppState) -> Result<Arc<BollardDocker>, IpcError> {
    let inner = state.inner.lock().await;
    inner.docker.clone().ok_or_else(|| disconnected_err(&inner))
}

fn abort_logs(inner: &mut Inner) {
    if let Some(tx) = inner.log_abort.take() {
        let _ = tx.send(());
    }
    inner.log_session_id = None;
}

fn abort_background(inner: &mut Inner) {
    abort_logs(inner);
    if let Some(tx) = inner.events_abort.take() {
        let _ = tx.send(());
    }
}

fn docker_is_current(inner: &Inner, docker: &Arc<BollardDocker>) -> bool {
    inner
        .docker
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, docker))
}

fn poll_events_once(
    stream: &mut Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>>,
) -> Poll<Option<Result<EngineEvent, DockboltError>>> {
    let waker = futures::task::noop_waker();
    let mut cx = Context::from_waker(&waker);
    stream.as_mut().poll_next(&mut cx)
}

async fn wait_backoff(abort: &mut tokio::sync::oneshot::Receiver<()>, backoff_ms: u64) -> bool {
    tokio::select! {
        biased;
        _ = &mut *abort => true,
        _ = tokio::time::sleep(Duration::from_millis(backoff_ms)) => false,
    }
}

async fn mark_events_unreachable(
    app: &AppHandle,
    docker: &Arc<BollardDocker>,
    err: &DockboltError,
) {
    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().await;
    if !docker_is_current(&inner, docker) {
        return;
    }
    abort_logs(&mut inner);
    let view = ConnectionView::Disconnected {
        reason: DockboltError::EngineUnreachable(err.to_string())
            .code()
            .to_string(),
        message: err.message(),
    };
    inner.connection = view.clone();
    drop(inner);
    emit_connection(app, &view);
}

async fn restore_connected_after_events(
    app: &AppHandle,
    docker: &Arc<BollardDocker>,
    connected_view: &ConnectionView,
) {
    if !matches!(connected_view, ConnectionView::Connected { .. }) {
        return;
    }
    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().await;
    if !docker_is_current(&inner, docker) {
        return;
    }
    let was_disconnected = matches!(inner.connection, ConnectionView::Disconnected { .. });
    if !was_disconnected {
        return;
    }
    inner.connection = connected_view.clone();
    drop(inner);
    emit_connection(app, connected_view);
}

fn emit_reconnect_invalidate(app: &AppHandle) {
    for resource in ["containers", "images", "volumes", "compose"] {
        emit_invalidate(app, resource);
    }
}

fn emit_connection(app: &AppHandle, view: &ConnectionView) {
    let _ = app.emit("connection://changed", view.clone());
}

fn emit_invalidate(app: &AppHandle, resource: &str) {
    let _ = app.emit(
        "resources://invalidate",
        InvalidatePayload {
            resource: resource.to_string(),
        },
    );
}

fn spawn_events(
    app: AppHandle,
    docker: Arc<BollardDocker>,
    abort: tokio::sync::oneshot::Receiver<()>,
) {
    tauri::async_runtime::spawn(async move {
        run_event_loop(app, docker, abort).await;
    });
}

fn emit_ready(app: &AppHandle, debouncer: &mut InvalidateDebouncer, now_ms: u64) {
    for kind in debouncer.take_ready(now_ms) {
        emit_invalidate(app, kind.as_str());
    }
}

async fn run_event_loop(
    app: AppHandle,
    docker: Arc<BollardDocker>,
    mut abort: tokio::sync::oneshot::Receiver<()>,
) {
    let mut backoff_ms = 200u64;
    let mut first_stream = true;
    let connected_view = {
        let state = app.state::<AppState>();
        let inner = state.inner.lock().await;
        inner.connection.clone()
    };

    loop {
        let mut debouncer = InvalidateDebouncer::new();
        let origin = Instant::now();
        let mut stream = docker.events();
        let is_reconnect = !first_stream;
        first_stream = false;

        let first = poll_events_once(&mut stream);
        match classify_events_poll(&first) {
            EventsSubscribe::ImmediateError => {
                let err = match first {
                    Poll::Ready(Some(Err(e))) => e,
                    _ => DockboltError::EngineUnreachable("events stream failed".into()),
                };
                mark_events_unreachable(&app, &docker, &err).await;
                if wait_backoff(&mut abort, backoff_ms).await {
                    return;
                }
                backoff_ms = backoff_ms.saturating_mul(2).min(5000);
                continue;
            }
            EventsSubscribe::ImmediateEnd => {
                if wait_backoff(&mut abort, backoff_ms).await {
                    return;
                }
                backoff_ms = backoff_ms.saturating_mul(2).min(5000);
                continue;
            }
            EventsSubscribe::Live => {
                backoff_ms = 200;
                if is_reconnect {
                    restore_connected_after_events(&app, &docker, &connected_view).await;
                    emit_reconnect_invalidate(&app);
                }
                if let Poll::Ready(Some(Ok(ev))) = first {
                    let now = origin.elapsed().as_millis() as u64;
                    debouncer.note(ev.resource, now);
                    emit_ready(&app, &mut debouncer, now);
                }
            }
        }

        let mut stream_alive = true;
        while stream_alive {
            tokio::select! {
                biased;
                _ = &mut abort => return,
                item = stream.next() => {
                    match item {
                        Some(Ok(ev)) => {
                            backoff_ms = 200;
                            let now = origin.elapsed().as_millis() as u64;
                            debouncer.note(ev.resource, now);
                            emit_ready(&app, &mut debouncer, now);
                        }
                        Some(Err(err)) => {
                            mark_events_unreachable(&app, &docker, &err).await;
                            stream_alive = false;
                        }
                        None => {
                            stream_alive = false;
                        }
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(INVALIDATE_DEBOUNCE_MS)) => {
                    let now = origin.elapsed().as_millis() as u64;
                    emit_ready(&app, &mut debouncer, now);
                }
            }
        }

        if wait_backoff(&mut abort, backoff_ms).await {
            return;
        }
        backoff_ms = backoff_ms.saturating_mul(2).min(5000);
    }
}

async fn connect_to_engine(app: &AppHandle, engine_id: &str) -> ConnectionView {
    let state = app.state::<AppState>();
    {
        let mut inner = state.inner.lock().await;
        abort_background(&mut inner);
        inner.docker = None;
        inner.connection = ConnectionView::Connecting;
        inner.selected_engine_id = Some(engine_id.to_string());
    }
    emit_connection(app, &ConnectionView::Connecting);

    let specs = engine_specs(&home_dir_string());
    let spec = match specs.into_iter().find(|s| s.engine_id == engine_id) {
        Some(s) => s,
        None => {
            let view = ConnectionView::Disconnected {
                reason: DockboltError::NotFound(engine_id.into()).code().to_string(),
                message: format!("unknown engine {engine_id}"),
            };
            {
                let mut inner = state.inner.lock().await;
                inner.connection = view.clone();
                inner.docker = None;
            }
            emit_connection(app, &view);
            return view;
        }
    };

    let result = async {
        if !std::path::Path::new(&spec.socket_path).exists() {
            return Err(DockboltError::SocketNotFound);
        }
        let docker = connect_unix(&spec.socket_path)?;
        let api_version = ping(&docker).await?;
        Ok::<_, DockboltError>((docker, api_version))
    }
    .await;

    match result {
        Ok((docker, api_version)) => {
            let docker = Arc::new(docker);
            let view = ConnectionView::Connected {
                engine_id: spec.engine_id.to_string(),
                name: spec.name.to_string(),
                endpoint: docker.endpoint.clone(),
                api_version,
            };
            let (events_tx, events_rx) = tokio::sync::oneshot::channel();
            {
                let mut inner = state.inner.lock().await;
                abort_background(&mut inner);
                inner.docker = Some(docker.clone());
                inner.selected_engine_id = Some(spec.engine_id.to_string());
                inner.connection = view.clone();
                inner.events_abort = Some(events_tx);
            }
            if let Ok(path) = engine_config_path(app) {
                if let Err(err) = state::save_engine_file(&path, spec.engine_id) {
                    tracing::warn!("failed to persist engine.json: {err}");
                }
            }
            spawn_events(app.clone(), docker, events_rx);
            emit_connection(app, &view);
            for resource in ["containers", "images", "volumes"] {
                emit_invalidate(app, resource);
            }
            view
        }
        Err(err) => {
            let view = ConnectionView::Disconnected {
                reason: err.code().to_string(),
                message: err.message(),
            };
            {
                let mut inner = state.inner.lock().await;
                inner.connection = view.clone();
                inner.docker = None;
            }
            emit_connection(app, &view);
            view
        }
    }
}

async fn bootstrap(app: AppHandle) {
    let saved = engine_config_path(&app)
        .ok()
        .and_then(|path| state::load_engine_file(&path));
    let candidates = probe_engines().await;
    match select_engine_id(saved.as_deref(), &candidates) {
        Some(id) => {
            let _ = connect_to_engine(&app, &id).await;
        }
        None => {
            let view = disconnected_from_candidates(&candidates);
            {
                let state = app.state::<AppState>();
                let mut inner = state.inner.lock().await;
                inner.connection = view.clone();
                inner.docker = None;
            }
            emit_connection(&app, &view);
        }
    }
}

async fn list_containers_inner(state: &AppState) -> Result<Vec<ContainerRow>, IpcError> {
    let docker = docker_from_state(state).await?;
    let mut rows = docker.list_containers().await?;
    sort_containers(&mut rows);
    Ok(rows)
}

async fn list_images_inner(state: &AppState) -> Result<Vec<ImageRow>, IpcError> {
    let docker = docker_from_state(state).await?;
    let containers = docker.list_containers().await?;
    let mut rows = docker.list_images().await?;
    classify_images(&mut rows, &containers);
    sort_images(&mut rows);
    Ok(rows)
}

async fn list_volumes_inner(state: &AppState) -> Result<Vec<VolumeRow>, IpcError> {
    let docker = docker_from_state(state).await?;
    Ok(list_classified_volumes(docker.as_ref()).await?)
}

async fn list_networks_inner(state: &AppState) -> Result<Vec<NetworkRow>, IpcError> {
    let docker = docker_from_state(state).await?;
    let mut rows = docker.list_networks().await?;
    sort_networks(&mut rows);
    Ok(rows)
}

#[tauri::command]
async fn list_engines() -> Result<Vec<EngineCandidate>, IpcError> {
    Ok(probe_engines().await)
}

#[tauri::command(rename_all = "snake_case")]
async fn connect_engine(app: AppHandle, engine_id: String) -> Result<ConnectionView, IpcError> {
    let ConnectArg { engine_id } = ConnectArg { engine_id };
    Ok(connect_to_engine(&app, &engine_id).await)
}

#[tauri::command]
async fn connection_status(state: State<'_, AppState>) -> Result<ConnectionView, IpcError> {
    Ok(state.inner.lock().await.connection.clone())
}

#[tauri::command]
async fn list_containers(state: State<'_, AppState>) -> Result<Vec<ContainerRow>, IpcError> {
    list_containers_inner(&state).await
}

#[tauri::command]
async fn list_images(state: State<'_, AppState>) -> Result<Vec<ImageRow>, IpcError> {
    list_images_inner(&state).await
}

#[tauri::command]
async fn list_volumes(state: State<'_, AppState>) -> Result<Vec<VolumeRow>, IpcError> {
    list_volumes_inner(&state).await
}

#[tauri::command]
async fn list_networks(state: State<'_, AppState>) -> Result<Vec<NetworkRow>, IpcError> {
    list_networks_inner(&state).await
}

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

#[tauri::command(rename_all = "snake_case")]
async fn stop_compose_project(
    state: State<'_, AppState>,
    project: String,
) -> Result<OkReply, IpcError> {
    let ProjectArg { project } = ProjectArg { project };
    let docker = docker_from_state(&state).await?;
    dockbolt_core::compose::stop_compose_project(docker.as_ref(), &project).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn down_compose_project(
    state: State<'_, AppState>,
    project: String,
) -> Result<OkReply, IpcError> {
    let ProjectArg { project } = ProjectArg { project };
    let docker = docker_from_state(&state).await?;
    dockbolt_core::compose::down_compose_project(docker.as_ref(), &project).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn pick_compose_file() -> Result<PickComposeReply, IpcError> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("Compose", &["yml", "yaml"])
            .set_title("Open Compose file")
            .pick_file()
    })
    .await
    .map_err(|err| ipc_internal(err.to_string()))?;
    Ok(PickComposeReply {
        path: picked.map(|path| path.to_string_lossy().into_owned()),
    })
}

#[tauri::command(rename_all = "snake_case")]
async fn up_compose_file(state: State<'_, AppState>, path: String) -> Result<OkReply, IpcError> {
    let PathArg { path } = PathArg { path };
    let file = PathBuf::from(&path);
    if !dockbolt_core::compose_file::is_compose_path(&file) {
        return Err(ipc_internal("Choose a .yml or .yaml Compose file"));
    }
    let contents = tokio::fs::read_to_string(&file)
        .await
        .map_err(|err| ipc_internal(err.to_string()))?;
    let project = dockbolt_core::compose_file::compose_project_name(&file, &contents);
    let docker_host = {
        let inner = state.inner.lock().await;
        match &inner.connection {
            ConnectionView::Connected { endpoint, .. } => endpoint.clone(),
            _ => {
                return Err(IpcError {
                    code: "engine_unreachable".into(),
                    message: "Connect to a Docker engine first".into(),
                });
            }
        }
    };
    let output = tokio::process::Command::new("docker")
        .args(["compose", "-p", &project, "-f", &path, "up", "-d"])
        .env("DOCKER_HOST", docker_host)
        .output()
        .await
        .map_err(|err| ipc_internal(format!("docker compose: {err}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = if !stderr.trim().is_empty() {
            stderr
        } else {
            stdout
        };
        return Err(ipc_internal(message.trim().to_string()));
    }
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn delete_container(state: State<'_, AppState>, id: String) -> Result<OkReply, IpcError> {
    let IdArg { id } = IdArg { id };
    let docker = docker_from_state(&state).await?;
    let rows = docker.list_containers().await?;
    let row = rows
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| IpcError {
            code: DockboltError::NotFound(id.clone()).code().to_string(),
            message: format!("container {id} not found"),
        })?;
    dockbolt_core::containers::delete_container(docker.as_ref(), &row).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn start_container(state: State<'_, AppState>, id: String) -> Result<OkReply, IpcError> {
    let IdArg { id } = IdArg { id };
    let docker = docker_from_state(&state).await?;
    dockbolt_core::containers::start_container(docker.as_ref(), &id).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn stop_container(state: State<'_, AppState>, id: String) -> Result<OkReply, IpcError> {
    let IdArg { id } = IdArg { id };
    let docker = docker_from_state(&state).await?;
    dockbolt_core::containers::stop_container(docker.as_ref(), &id).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn restart_container(state: State<'_, AppState>, id: String) -> Result<OkReply, IpcError> {
    let IdArg { id } = IdArg { id };
    let docker = docker_from_state(&state).await?;
    dockbolt_core::containers::restart_container(docker.as_ref(), &id).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn inspect_container(
    state: State<'_, AppState>,
    id: String,
) -> Result<ContainerInspect, IpcError> {
    let IdArg { id } = IdArg { id };
    let docker = docker_from_state(&state).await?;
    Ok(dockbolt_core::inspect::inspect_container(docker.as_ref(), &id).await?)
}

#[tauri::command(rename_all = "snake_case")]
async fn prune_preview(state: State<'_, AppState>) -> Result<PrunePreview, IpcError> {
    let docker = docker_from_state(&state).await?;
    Ok(dockbolt_core::prune::prune_preview(docker.as_ref()).await?)
}

#[tauri::command(rename_all = "snake_case")]
async fn prune_now(state: State<'_, AppState>) -> Result<PruneReport, IpcError> {
    let docker = docker_from_state(&state).await?;
    Ok(dockbolt_core::prune::run_prune(docker.as_ref()).await?)
}

#[tauri::command(rename_all = "snake_case")]
async fn open_url(url: String) -> Result<OkReply, IpcError> {
    if !dockbolt_core::ports::is_allowed_browser_url(&url) {
        return Err(IpcError {
            code: "internal".into(),
            message: "only http(s) URLs can be opened".into(),
        });
    }
    tauri::async_runtime::spawn_blocking(move || open::that(url))
        .await
        .map_err(|err| ipc_internal(err.to_string()))?
        .map_err(|err| ipc_internal(err.to_string()))?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn delete_image(state: State<'_, AppState>, id: String) -> Result<OkReply, IpcError> {
    let IdArg { id } = IdArg { id };
    let docker = docker_from_state(&state).await?;
    dockbolt_core::images::delete_image(docker.as_ref(), &id).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn delete_volume(state: State<'_, AppState>, name: String) -> Result<OkReply, IpcError> {
    let NameArg { name } = NameArg { name };
    let docker = docker_from_state(&state).await?;
    dockbolt_core::volumes::delete_volume(docker.as_ref(), &name).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn delete_network(state: State<'_, AppState>, id: String) -> Result<OkReply, IpcError> {
    let IdArg { id } = IdArg { id };
    let docker = docker_from_state(&state).await?;
    let rows = docker.list_networks().await?;
    let row = rows
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| IpcError {
            code: DockboltError::NotFound(id.clone()).code().to_string(),
            message: format!("network {id} not found"),
        })?;
    dockbolt_core::networks::delete_network(docker.as_ref(), &row).await?;
    Ok(OkReply { ok: true })
}

#[tauri::command(rename_all = "snake_case")]
async fn refresh(
    state: State<'_, AppState>,
    resource: String,
) -> Result<serde_json::Value, IpcError> {
    let RefreshArg { resource } = RefreshArg { resource };
    match resource.as_str() {
        "containers" => {
            serde_json::to_value(list_containers_inner(&state).await?).map_err(ipc_internal)
        }
        "images" => serde_json::to_value(list_images_inner(&state).await?).map_err(ipc_internal),
        "volumes" => serde_json::to_value(list_volumes_inner(&state).await?).map_err(ipc_internal),
        "networks" => {
            serde_json::to_value(list_networks_inner(&state).await?).map_err(ipc_internal)
        }
        "all" => {
            let containers = list_containers_inner(&state).await?;
            let images = list_images_inner(&state).await?;
            let volumes = list_volumes_inner(&state).await?;
            let networks = list_networks_inner(&state).await?;
            serde_json::to_value(serde_json::json!({
                "containers": containers,
                "images": images,
                "volumes": volumes,
                "networks": networks,
            }))
            .map_err(ipc_internal)
        }
        other => Err(ipc_internal(format!("unknown resource {other}"))),
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn start_logs(
    app: AppHandle,
    state: State<'_, AppState>,
    container_id: String,
) -> Result<SessionReply, IpcError> {
    let StartLogsArg { container_id } = StartLogsArg { container_id };
    let docker = docker_from_state(&state).await?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel();
    {
        let mut inner = state.inner.lock().await;
        if let Some(prev) = inner.log_abort.take() {
            let _ = prev.send(());
        }
        inner.log_abort = Some(abort_tx);
        inner.log_session_id = Some(session_id.clone());
    }
    let app_clone = app.clone();
    let sid = session_id.clone();
    tauri::async_runtime::spawn(async move {
        run_log_session(app_clone, docker, container_id, sid, abort_rx).await;
    });
    Ok(SessionReply { session_id })
}

#[tauri::command(rename_all = "snake_case")]
async fn stop_logs(state: State<'_, AppState>, session_id: String) -> Result<OkReply, IpcError> {
    let StopLogsArg { session_id } = StopLogsArg { session_id };
    let mut inner = state.inner.lock().await;
    if inner.log_session_id.as_deref() == Some(session_id.as_str()) {
        if let Some(tx) = inner.log_abort.take() {
            let _ = tx.send(());
        }
        inner.log_session_id = None;
    }
    Ok(OkReply { ok: true })
}

async fn enqueue_log_batch(
    queue: &Arc<tokio::sync::Mutex<BatchQueue>>,
    omitted: &Arc<std::sync::atomic::AtomicU64>,
    kick: &tokio::sync::mpsc::Sender<()>,
    lines: Vec<LogLine>,
) {
    if lines.is_empty() {
        return;
    }
    {
        let mut guard = queue.lock().await;
        let n = guard.push_batch(lines);
        if n > 0 {
            omitted.fetch_add(n, std::sync::atomic::Ordering::Relaxed);
        }
    }
    let _ = kick.try_send(());
}

async fn drain_log_batches(
    app: &AppHandle,
    session_id: &str,
    queue: &Arc<tokio::sync::Mutex<BatchQueue>>,
    omitted: &Arc<std::sync::atomic::AtomicU64>,
) {
    loop {
        let batch = queue.lock().await.pop_batch();
        let Some(lines) = batch else { break };
        let om = omitted.swap(0, std::sync::atomic::Ordering::Relaxed);
        let _ = app.emit(
            "logs://batch",
            LogBatchPayload {
                session_id: session_id.to_string(),
                lines,
                omitted: om,
            },
        );
    }
}

async fn run_log_session(
    app: AppHandle,
    docker: Arc<BollardDocker>,
    container_id: String,
    session_id: String,
    mut abort: tokio::sync::oneshot::Receiver<()>,
) {
    let queue = Arc::new(tokio::sync::Mutex::new(BatchQueue::new(
        LOG_CHANNEL_CAPACITY,
    )));
    let omitted = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let (kick_tx, mut kick_rx) = tokio::sync::mpsc::channel::<()>(1);

    let emit_app = app.clone();
    let emit_sid = session_id.clone();
    let emit_q = queue.clone();
    let emit_om = omitted.clone();
    let consumer = async move {
        while kick_rx.recv().await.is_some() {
            drain_log_batches(&emit_app, &emit_sid, &emit_q, &emit_om).await;
        }
        drain_log_batches(&emit_app, &emit_sid, &emit_q, &emit_om).await;
    };

    let produce_q = queue.clone();
    let produce_om = omitted.clone();
    let producer = async move {
        let mut seq = LogSeq::default();
        let mut buf: Vec<LogLine> = Vec::new();
        let mut last = Instant::now();
        let mut stream = docker.logs(&container_id);
        let reason;

        loop {
            tokio::select! {
                biased;
                _ = &mut abort => {
                    reason = "stopped";
                    break;
                }
                item = stream.next() => {
                    match item {
                        Some(Ok(chunk)) => {
                            buf.push(seq.next_line(chunk.stream, chunk.timestamp_unix_ms, chunk.text));
                            if should_flush(buf.len(), last.elapsed()) {
                                enqueue_log_batch(&produce_q, &produce_om, &kick_tx, std::mem::take(&mut buf)).await;
                                last = Instant::now();
                            }
                        }
                        Some(Err(err)) => {
                            reason = if err.code() == "not_found" {
                                "container_gone"
                            } else if err.code() == "engine_unreachable" {
                                "disconnected"
                            } else {
                                "error"
                            };
                            break;
                        }
                        None => {
                            reason = "container_gone";
                            break;
                        }
                    }
                }
                _ = tokio::time::sleep(LOG_BATCH_WINDOW), if !buf.is_empty() => {
                    if should_flush(buf.len(), last.elapsed()) {
                        enqueue_log_batch(&produce_q, &produce_om, &kick_tx, std::mem::take(&mut buf)).await;
                        last = Instant::now();
                    }
                }
            }
        }
        enqueue_log_batch(&produce_q, &produce_om, &kick_tx, buf).await;
        reason
    };

    let (reason, _) = tokio::join!(producer, consumer);
    let _ = app.emit(
        "logs://ended",
        LogEndedPayload {
            session_id,
            reason: reason.to_string(),
        },
    );
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                bootstrap(handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_engines,
            connect_engine,
            connection_status,
            list_containers,
            list_images,
            list_volumes,
            list_networks,
            list_compose_projects,
            start_compose_project,
            stop_compose_project,
            down_compose_project,
            pick_compose_file,
            up_compose_file,
            delete_container,
            start_container,
            stop_container,
            restart_container,
            inspect_container,
            prune_preview,
            prune_now,
            open_url,
            delete_image,
            delete_volume,
            delete_network,
            refresh,
            start_logs,
            stop_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
