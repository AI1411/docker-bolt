use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceKind {
    Containers,
    Images,
    Volumes,
    Networks,
    Compose,
}

impl ResourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Containers => "containers",
            Self::Images => "images",
            Self::Volumes => "volumes",
            Self::Networks => "networks",
            Self::Compose => "compose",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PublishedPort {
    pub host_ip: String,
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String,
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
    #[serde(default)]
    pub ports: Vec<PublishedPort>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectEnv {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectMount {
    pub source: String,
    pub destination: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContainerInspect {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub created: String,
    pub ports: Vec<PublishedPort>,
    pub mounts: Vec<InspectMount>,
    pub networks: Vec<String>,
    pub restart_policy: String,
    pub env: Vec<InspectEnv>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkRow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub driver: String,
    #[serde(default)]
    pub scope: String,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PruneDelta {
    pub deleted: u32,
    pub space_reclaimed_bytes: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrunePreview {
    pub stopped_containers: u32,
    pub dangling_images: u32,
    pub unused_networks: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PruneReport {
    pub containers_deleted: u32,
    pub images_deleted: u32,
    pub networks_deleted: u32,
    pub space_reclaimed_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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
