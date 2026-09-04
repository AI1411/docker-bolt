use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::{ContainerInspect, InspectEnv, PublishedPort};

pub async fn inspect_container(
    docker: &dyn DockerPort,
    id: &str,
) -> Result<ContainerInspect, DockboltError> {
    docker.inspect_container(id).await
}

pub fn parse_env_entry(raw: &str) -> InspectEnv {
    match raw.split_once('=') {
        Some((name, value)) => InspectEnv {
            name: name.to_string(),
            value: value.to_string(),
        },
        None => InspectEnv {
            name: raw.to_string(),
            value: String::new(),
        },
    }
}

pub fn parse_port_spec(spec: &str) -> Option<(u16, String)> {
    let (port, proto) = spec.split_once('/')?;
    Some((port.parse().ok()?, proto.to_lowercase()))
}

pub fn binding_to_published(spec: &str, host_ip: &str, host_port: &str) -> Option<PublishedPort> {
    let (container_port, protocol) = parse_port_spec(spec)?;
    Some(PublishedPort {
        host_ip: host_ip.to_string(),
        host_port: host_port.parse().ok()?,
        container_port,
        protocol,
    })
}

pub fn restart_policy_label(name: &str, retry: i64) -> String {
    let trimmed = name.trim();
    let label = if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("no") {
        "no"
    } else {
        trimmed
    };
    if label.eq_ignore_ascii_case("on-failure") && retry > 0 {
        format!("{label}:{retry}")
    } else {
        label.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_splits_on_first_equals() {
        assert_eq!(
            parse_env_entry("PATH=/usr/bin:/bin"),
            InspectEnv {
                name: "PATH".into(),
                value: "/usr/bin:/bin".into(),
            }
        );
        assert_eq!(
            parse_env_entry("FLAG"),
            InspectEnv {
                name: "FLAG".into(),
                value: String::new(),
            }
        );
    }

    #[test]
    fn published_binding_skips_missing_host_port() {
        let port = binding_to_published("80/tcp", "0.0.0.0", "8080").unwrap();
        assert_eq!(port.host_port, 8080);
        assert_eq!(port.container_port, 80);
        assert_eq!(binding_to_published("80/tcp", "0.0.0.0", ""), None);
    }

    #[test]
    fn restart_on_failure_includes_retry() {
        assert_eq!(restart_policy_label("", 0), "no");
        assert_eq!(restart_policy_label("on-failure", 5), "on-failure:5");
        assert_eq!(restart_policy_label("always", 0), "always");
    }
}
