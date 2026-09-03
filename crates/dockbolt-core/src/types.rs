use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContainerRow {
    pub id: String,
    pub name: String,
    pub image: String,
    #[serde(default)]
    pub image_id: String,
    pub state: String,
    pub running: bool,
    pub created_unix: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compose_project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compose_service: Option<String>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageRow {
    pub id: String,
    pub tags: Vec<String>,
    pub size_bytes: u64,
    pub created_unix: i64,
    #[serde(default)]
    pub in_use: bool,
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
    pub timestamp_unix_ms: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct EngineEvent {
    pub resource: ResourceKind,
}
