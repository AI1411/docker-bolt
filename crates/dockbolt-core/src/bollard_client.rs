use std::pin::Pin;

use async_trait::async_trait;
use bollard::container::{ListContainersOptions, LogsOptions, RemoveContainerOptions};
use bollard::image::{ListImagesOptions, RemoveImageOptions};
use bollard::volume::{ListVolumesOptions, RemoveVolumeOptions};
use bollard::Docker;
use futures::{Stream, StreamExt};

use crate::client::DockerPort;
use crate::containers::normalize_container_name;
use crate::error::{map_status_and_message, DockboltError};
use crate::events::resources_from_docker_type;
use crate::logs::{parse_docker_log_text, LOG_TAIL};
use crate::types::{
    ContainerRow, EngineEvent, ImageRow, LogStream, NetworkRow, PublishedPort, RawLogChunk,
    VolumeRow,
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
