use std::collections::HashMap;
use std::pin::Pin;

use async_trait::async_trait;
use bollard::container::{ListContainersOptions, LogsOptions, RemoveContainerOptions};
use bollard::image::{ListImagesOptions, PruneImagesOptions, RemoveImageOptions};
use bollard::volume::{ListVolumesOptions, RemoveVolumeOptions};
use bollard::Docker;
use futures::{Stream, StreamExt};

use crate::client::DockerPort;
use crate::containers::normalize_container_name;
use crate::error::{map_status_and_message, DockboltError};
use crate::events::resources_from_docker_type;
use crate::inspect::{binding_to_published, parse_env_entry, restart_policy_label};
use crate::logs::{parse_docker_log_text, LOG_TAIL};
use crate::types::{
    ContainerInspect, ContainerRow, EngineEvent, ImageRow, InspectMount, LogStream, NetworkRow,
    PruneDelta, PublishedPort, RawLogChunk, VolumeRow,
};

pub struct BollardDocker {
    docker: Docker,
    pub endpoint: String,
}

pub fn connect_unix(socket_path: &str) -> Result<BollardDocker, DockboltError> {
    let addr = if socket_path.starts_with("unix://") {
        socket_path.to_string()
    } else {
        format!("unix://{socket_path}")
    };
    let docker = Docker::connect_with_unix(&addr, 120, bollard::API_DEFAULT_VERSION)
        .map_err(map_bollard_error)?;
    Ok(BollardDocker {
        docker,
        endpoint: addr,
    })
}

pub fn map_bollard_error(err: bollard::errors::Error) -> DockboltError {
    if matches!(err, bollard::errors::Error::SocketNotFoundError(_)) {
        return DockboltError::SocketNotFound;
    }
    let msg = err.to_string();
    let status = match &err {
        bollard::errors::Error::DockerResponseServerError { status_code, .. } => Some(*status_code),
        _ => status_from_message(&msg),
    };
    map_status_and_message(status, &msg)
}

fn ignore_not_modified(result: Result<(), bollard::errors::Error>) -> Result<(), DockboltError> {
    match result {
        Ok(()) => Ok(()),
        Err(err) => {
            if let bollard::errors::Error::DockerResponseServerError { status_code, .. } = &err {
                if *status_code == 304 {
                    return Ok(());
                }
            }
            Err(map_bollard_error(err))
        }
    }
}

fn status_from_message(msg: &str) -> Option<u16> {
    let lower = msg.to_lowercase();
    let marker = "status code";
    let idx = lower.find(marker)?;
    let rest = &msg[idx + marker.len()..];
    let digits: String = rest
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

fn map_log_output(output: bollard::container::LogOutput) -> RawLogChunk {
    let (stream, message) = match output {
        bollard::container::LogOutput::StdErr { message } => (LogStream::Stderr, message),
        bollard::container::LogOutput::StdOut { message } => (LogStream::Stdout, message),
        bollard::container::LogOutput::Console { message } => (LogStream::Stdout, message),
        bollard::container::LogOutput::StdIn { message } => (LogStream::Stdout, message),
    };
    RawLogChunk {
        stream,
        text: String::from_utf8_lossy(&message)
            .trim_end_matches('\n')
            .to_string(),
        timestamp_unix_ms: None,
    }
}

fn docker_event_type(ev: &bollard::models::EventMessage) -> Option<String> {
    ev.typ.as_ref().map(|t| t.to_string().to_lowercase())
}

#[async_trait]
impl DockerPort for BollardDocker {
    async fn version(&self) -> Result<String, DockboltError> {
        let v = self.docker.version().await.map_err(map_bollard_error)?;
        Ok(v.api_version.unwrap_or_else(|| "unknown".into()))
    }

    async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
        let opts = ListContainersOptions::<String> {
            all: true,
            ..Default::default()
        };
        let list = self
            .docker
            .list_containers(Some(opts))
            .await
            .map_err(map_bollard_error)?;
        Ok(list
            .into_iter()
            .map(|c| {
                let id = c.id.clone().unwrap_or_default();
                let names = c.names.unwrap_or_default();
                let state = c.state.clone().unwrap_or_default();
                let labels = c.labels.unwrap_or_default();
                let compose_project = labels
                    .get("com.docker.compose.project")
                    .cloned()
                    .filter(|s| !s.is_empty());
                let compose_service = labels
                    .get("com.docker.compose.service")
                    .cloned()
                    .filter(|s| !s.is_empty());
                ContainerRow {
                    name: normalize_container_name(&names, &id),
                    image: c.image.unwrap_or_default(),
                    image_id: c.image_id.unwrap_or_default(),
                    running: state.eq_ignore_ascii_case("running"),
                    state,
                    created_unix: c.created.unwrap_or(0),
                    id,
                    compose_project,
                    compose_service,
                    ports: c
                        .ports
                        .unwrap_or_default()
                        .into_iter()
                        .filter_map(|port| {
                            Some(PublishedPort {
                                host_ip: port.ip.unwrap_or_default(),
                                host_port: port.public_port?,
                                container_port: port.private_port,
                                protocol: port
                                    .typ
                                    .map(|kind| kind.to_string().to_lowercase())
                                    .unwrap_or_else(|| "tcp".into()),
                            })
                        })
                        .collect(),
                }
            })
            .collect())
    }

    async fn inspect_container(&self, id: &str) -> Result<ContainerInspect, DockboltError> {
        let info = self
            .docker
            .inspect_container(id, None)
            .await
            .map_err(map_bollard_error)?;
        let name = crate::containers::normalize_container_name(
            &info
                .name
                .as_deref()
                .map(|n| vec![n.to_string()])
                .unwrap_or_default(),
            info.id.as_deref().unwrap_or(id),
        );
        let state = info
            .state
            .as_ref()
            .and_then(|s| s.status.as_ref())
            .map(|s| s.to_string().to_lowercase())
            .unwrap_or_default();
        let image = info
            .config
            .as_ref()
            .and_then(|c| c.image.clone())
            .or(info.image.clone())
            .unwrap_or_default();
        let env = info
            .config
            .as_ref()
            .and_then(|c| c.env.clone())
            .unwrap_or_default()
            .iter()
            .map(|raw| parse_env_entry(raw))
            .collect();
        let mounts = info
            .mounts
            .unwrap_or_default()
            .into_iter()
            .map(|m| InspectMount {
                source: m.source.unwrap_or_default(),
                destination: m.destination.unwrap_or_default(),
            })
            .filter(|m| !m.source.is_empty() || !m.destination.is_empty())
            .collect();
        let networks = info
            .network_settings
            .as_ref()
            .and_then(|n| n.networks.as_ref())
            .map(|nets| {
                let mut names: Vec<String> = nets.keys().cloned().collect();
                names.sort();
                names
            })
            .unwrap_or_default();
        let ports = info
            .network_settings
            .as_ref()
            .and_then(|n| n.ports.as_ref())
            .map(|map| {
                let mut out = Vec::new();
                for (spec, bindings) in map {
                    for binding in bindings.iter().flatten() {
                        if let Some(port) = binding_to_published(
                            spec,
                            binding.host_ip.as_deref().unwrap_or(""),
                            binding.host_port.as_deref().unwrap_or(""),
                        ) {
                            out.push(port);
                        }
                    }
                }
                out
            })
            .unwrap_or_default();
        let (policy_name, retry) = info
            .host_config
            .as_ref()
            .and_then(|h| h.restart_policy.as_ref())
            .map(|p| {
                (
                    p.name
                        .as_ref()
                        .map(|n| {
                            let raw = n.to_string().to_lowercase().replace('_', "-");
                            if raw == "empty" {
                                String::new()
                            } else {
                                raw
                            }
                        })
                        .unwrap_or_default(),
                    p.maximum_retry_count.unwrap_or(0),
                )
            })
            .unwrap_or_else(|| (String::new(), 0));
        Ok(ContainerInspect {
            id: info.id.unwrap_or_else(|| id.to_string()),
            name,
            image,
            state,
            created: info.created.unwrap_or_default(),
            ports,
            mounts,
            networks,
            restart_policy: restart_policy_label(&policy_name, retry),
            env,
        })
    }

    async fn remove_container(&self, id: &str, force: bool) -> Result<(), DockboltError> {
        self.docker
            .remove_container(
                id,
                Some(RemoveContainerOptions {
                    force,
                    ..Default::default()
                }),
            )
            .await
            .map_err(map_bollard_error)
    }

    async fn start_container(&self, id: &str) -> Result<(), DockboltError> {
        ignore_not_modified(self.docker.start_container::<String>(id, None).await)
    }

    async fn stop_container(&self, id: &str) -> Result<(), DockboltError> {
        ignore_not_modified(self.docker.stop_container(id, None).await)
    }

    async fn restart_container(&self, id: &str) -> Result<(), DockboltError> {
        ignore_not_modified(self.docker.restart_container(id, None).await)
    }

    async fn list_networks(&self) -> Result<Vec<NetworkRow>, DockboltError> {
        let list = self
            .docker
            .list_networks::<String>(None)
            .await
            .map_err(map_bollard_error)?;
        Ok(list
            .into_iter()
            .map(|n| {
                let labels = n.labels.unwrap_or_default();
                NetworkRow {
                    id: n.id.unwrap_or_default(),
                    name: n.name.unwrap_or_default(),
                    driver: n.driver.unwrap_or_default(),
                    scope: n.scope.unwrap_or_default(),
                    compose_project: labels
                        .get("com.docker.compose.project")
                        .cloned()
                        .filter(|s| !s.is_empty()),
                }
            })
            .collect())
    }

    async fn remove_network(&self, id: &str) -> Result<(), DockboltError> {
        self.docker
            .remove_network(id)
            .await
            .map_err(map_bollard_error)
    }

    async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError> {
        let list = self
            .docker
            .list_images(Some(ListImagesOptions::<String> {
                all: true,
                ..Default::default()
            }))
            .await
            .map_err(map_bollard_error)?;
        Ok(list
            .into_iter()
            .map(|img| ImageRow {
                id: img.id,
                tags: img.repo_tags,
                size_bytes: img.size as u64,
                created_unix: img.created,
                in_use: false,
            })
            .collect())
    }

    async fn remove_image(&self, id: &str) -> Result<(), DockboltError> {
        self.docker
            .remove_image(
                id,
                Some(RemoveImageOptions {
                    force: false,
                    noprune: false,
                }),
                None,
            )
            .await
            .map(|_| ())
            .map_err(map_bollard_error)
    }

    async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError> {
        let resp = self
            .docker
            .list_volumes(None::<ListVolumesOptions<String>>)
            .await
            .map_err(map_bollard_error)?;
        Ok(resp
            .volumes
            .unwrap_or_default()
            .into_iter()
            .map(|v| VolumeRow {
                name: v.name,
                driver: v.driver,
            })
            .collect())
    }

    async fn remove_volume(&self, name: &str) -> Result<(), DockboltError> {
        self.docker
            .remove_volume(name, Some(RemoveVolumeOptions { force: false }))
            .await
            .map_err(map_bollard_error)
    }

    async fn prune_stopped_containers(&self) -> Result<PruneDelta, DockboltError> {
        let resp = self
            .docker
            .prune_containers(None::<bollard::container::PruneContainersOptions<String>>)
            .await
            .map_err(map_bollard_error)?;
        Ok(PruneDelta {
            deleted: resp.containers_deleted.unwrap_or_default().len() as u32,
            space_reclaimed_bytes: resp.space_reclaimed.unwrap_or(0).max(0) as u64,
        })
    }

    async fn prune_dangling_images(&self) -> Result<PruneDelta, DockboltError> {
        let mut filters = HashMap::new();
        filters.insert("dangling", vec!["true"]);
        let resp = self
            .docker
            .prune_images(Some(PruneImagesOptions { filters }))
            .await
            .map_err(map_bollard_error)?;
        Ok(PruneDelta {
            deleted: resp.images_deleted.unwrap_or_default().len() as u32,
            space_reclaimed_bytes: resp.space_reclaimed.unwrap_or(0).max(0) as u64,
        })
    }

    async fn prune_unused_networks(&self) -> Result<PruneDelta, DockboltError> {
        let resp = self
            .docker
            .prune_networks(None::<bollard::network::PruneNetworksOptions<String>>)
            .await
            .map_err(map_bollard_error)?;
        Ok(PruneDelta {
            deleted: resp.networks_deleted.unwrap_or_default().len() as u32,
            space_reclaimed_bytes: 0,
        })
    }

    fn logs(
        &self,
        container_id: &str,
    ) -> Pin<Box<dyn Stream<Item = Result<RawLogChunk, DockboltError>> + Send>> {
        let id = container_id.to_string();
        let docker = self.docker.clone();
        Box::pin(async_stream::stream! {
            let opts = LogsOptions::<String> {
                follow: true,
                stdout: true,
                stderr: true,
                timestamps: true,
                tail: LOG_TAIL.to_string(),
                ..Default::default()
            };
            let mut s = docker.logs(&id, Some(opts));
            while let Some(item) = s.next().await {
                match item {
                    Ok(out) => {
                        let chunk = map_log_output(out);
                        let (ts, raw) = parse_docker_log_text(&chunk.text);
                        yield Ok(RawLogChunk {
                            stream: chunk.stream,
                            text: raw,
                            timestamp_unix_ms: ts,
                        });
                    }
                    Err(e) => yield Err(map_bollard_error(e)),
                }
            }
        })
    }

    fn events(&self) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>> {
        let docker = self.docker.clone();
        Box::pin(async_stream::stream! {
            let mut s = docker.events(None::<bollard::system::EventsOptions<String>>);
            while let Some(item) = s.next().await {
                match item {
                    Ok(ev) => {
                        if let Some(ty) = docker_event_type(&ev) {
                            for kind in resources_from_docker_type(&ty) {
                                yield Ok(EngineEvent { resource: kind });
                            }
                        }
                    }
                    Err(e) => yield Err(map_bollard_error(e)),
                }
            }
        })
    }
}
