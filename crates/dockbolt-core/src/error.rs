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
