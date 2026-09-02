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

pub fn map_status_and_message(status: Option<u16>, message: &str) -> DockboltError {
    let lower = message.to_lowercase();
    if lower.contains("permission denied") || lower.contains("eacces") {
        return DockboltError::PermissionDenied;
    }
    match status {
        Some(404) => DockboltError::NotFound(message.to_string()),
        Some(409)
            if lower.contains("in use")
                || lower.contains("being used")
                || lower.contains("conflict") =>
        {
            DockboltError::InUse {
                summary: message.to_string(),
            }
        }
        Some(409) => DockboltError::Conflict(message.to_string()),
        _ => DockboltError::EngineUnreachable(message.to_string()),
    }
}

#[cfg(test)]
mod map_status_tests {
    use super::*;

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
}
