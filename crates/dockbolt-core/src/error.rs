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

fn is_connection_failure(lower: &str) -> bool {
    lower.contains("connection refused")
        || lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("error trying to connect")
        || lower.contains("network unreachable")
        || lower.contains("not connected")
        || lower.contains("connection aborted")
}

pub fn map_status_and_message(status: Option<u16>, message: &str) -> DockboltError {
    let lower = message.to_lowercase();
    if lower.contains("permission denied") || lower.contains("eacces") {
        return DockboltError::PermissionDenied;
    }
    if lower.contains("timed out") || lower.contains("timeout") {
        return DockboltError::Timeout;
    }
    match status {
        Some(404) => DockboltError::NotFound(message.to_string()),
        Some(409) if lower.contains("in use") || lower.contains("being used") => {
            DockboltError::InUse {
                summary: message.to_string(),
            }
        }
        Some(409) => DockboltError::Conflict(message.to_string()),
        _ if is_connection_failure(&lower) => DockboltError::EngineUnreachable(message.to_string()),
        _ => DockboltError::Internal(message.to_string()),
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
    fn maps_in_use_being_used() {
        assert_eq!(
            map_status_and_message(Some(409), "volume is being used by a container").code(),
            "in_use"
        );
    }

    #[test]
    fn maps_409_without_in_use_to_conflict() {
        assert_eq!(
            map_status_and_message(Some(409), "conflict: already exists").code(),
            "conflict"
        );
    }

    #[test]
    fn maps_404() {
        assert_eq!(
            map_status_and_message(Some(404), "no such container").code(),
            "not_found"
        );
    }

    #[test]
    fn maps_timeout() {
        assert_eq!(
            map_status_and_message(None, "operation timed out").code(),
            "timeout"
        );
    }

    #[test]
    fn maps_connection_failure() {
        assert_eq!(
            map_status_and_message(None, "error trying to connect: Connection refused").code(),
            "engine_unreachable"
        );
    }

    #[test]
    fn maps_unknown_to_internal() {
        assert_eq!(
            map_status_and_message(Some(500), "unhandled docker error").code(),
            "internal"
        );
        assert_eq!(
            map_status_and_message(None, "something else").code(),
            "internal"
        );
    }
}
