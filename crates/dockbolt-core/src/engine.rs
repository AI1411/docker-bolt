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
