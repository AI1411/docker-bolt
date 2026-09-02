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
