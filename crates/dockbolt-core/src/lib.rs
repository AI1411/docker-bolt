pub mod client;
pub mod error;
pub mod types;

pub use client::DockerPort;
pub use error::DockboltError;
pub use types::*;

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
