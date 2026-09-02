use std::path::{Path, PathBuf};
use std::sync::Arc;

use dockbolt_core::bollard_client::BollardDocker;
use dockbolt_core::ConnectionView;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct EngineFile {
    pub selected_engine_id: String,
}

pub struct AppState {
    pub inner: tokio::sync::Mutex<Inner>,
}

pub struct Inner {
    pub connection: ConnectionView,
    pub docker: Option<Arc<BollardDocker>>,
    pub selected_engine_id: Option<String>,
    pub log_abort: Option<tokio::sync::oneshot::Sender<()>>,
    pub events_abort: Option<tokio::sync::oneshot::Sender<()>>,
    pub log_session_id: Option<String>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: tokio::sync::Mutex::new(Inner {
                connection: ConnectionView::Connecting,
                docker: None,
                selected_engine_id: None,
                log_abort: None,
                events_abort: None,
                log_session_id: None,
            }),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

pub fn engine_json_path(config_dir: PathBuf) -> PathBuf {
    config_dir.join("engine.json")
}

pub fn load_engine_file(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let parsed: EngineFile = serde_json::from_str(&raw).ok()?;
    if parsed.selected_engine_id.is_empty() {
        None
    } else {
        Some(parsed.selected_engine_id)
    }
}

pub fn save_engine_file(path: &Path, engine_id: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let file = EngineFile {
        selected_engine_id: engine_id.to_string(),
    };
    let raw = serde_json::to_string(&file).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;
    std::fs::write(path, raw)
}

#[cfg(test)]
mod tests {
    use super::{load_engine_file, save_engine_file, EngineFile};

    #[test]
    fn engine_file_roundtrip() {
        let raw = serde_json::to_string(&EngineFile {
            selected_engine_id: "orbstack".into(),
        })
        .unwrap();
        let parsed: EngineFile = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.selected_engine_id, "orbstack");
    }

    #[test]
    fn invalid_engine_json_treated_as_missing() {
        let dir = std::env::temp_dir().join(format!(
            "dockbolt-engine-json-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("engine.json");
        std::fs::write(&path, "{not json").unwrap();
        assert_eq!(load_engine_file(&path), None);
        save_engine_file(&path, "orbstack").unwrap();
        assert_eq!(load_engine_file(&path).as_deref(), Some("orbstack"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
