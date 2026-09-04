use std::collections::HashSet;

use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::networks::is_system_network;
use crate::types::{ImageRow, NetworkRow, PrunePreview, PruneReport};

pub fn is_dangling_image(image: &ImageRow) -> bool {
    image
        .tags
        .iter()
        .all(|tag| tag.is_empty() || tag == "<none>")
}

pub fn unused_user_networks(networks: &[NetworkRow], used_names: &HashSet<String>) -> u32 {
    networks
        .iter()
        .filter(|net| !is_system_network(&net.name) && !used_names.contains(&net.name))
        .count() as u32
}

pub async fn prune_preview(docker: &dyn DockerPort) -> Result<PrunePreview, DockboltError> {
    let containers = docker.list_containers().await?;
    let images = docker.list_images().await?;
    let networks = docker.list_networks().await?;
    let mut used = HashSet::new();
    let mut inspect_failed = false;
    for container in &containers {
        match docker.inspect_container(&container.id).await {
            Ok(info) => used.extend(info.networks),
            Err(_) => inspect_failed = true,
        }
    }
    let unused_networks = if inspect_failed {
        0
    } else {
        unused_user_networks(&networks, &used)
    };
    Ok(PrunePreview {
        stopped_containers: containers.iter().filter(|row| !row.running).count() as u32,
        dangling_images: images
            .iter()
            .filter(|image| is_dangling_image(image))
            .count() as u32,
        unused_networks,
    })
}

pub async fn run_prune(docker: &dyn DockerPort) -> Result<PruneReport, DockboltError> {
    let mut report = PruneReport::default();
    let mut errors = Vec::new();
    match docker.prune_stopped_containers().await {
        Ok(delta) => {
            report.containers_deleted = delta.deleted;
            report.space_reclaimed_bytes += delta.space_reclaimed_bytes;
        }
        Err(err) => errors.push(err.message()),
    }
    match docker.prune_dangling_images().await {
        Ok(delta) => {
            report.images_deleted = delta.deleted;
            report.space_reclaimed_bytes += delta.space_reclaimed_bytes;
        }
        Err(err) => errors.push(err.message()),
    }
    match docker.prune_unused_networks().await {
        Ok(delta) => {
            report.networks_deleted = delta.deleted;
            report.space_reclaimed_bytes += delta.space_reclaimed_bytes;
        }
        Err(err) => errors.push(err.message()),
    }
    if !errors.is_empty() {
        report.error = Some(errors.join("\n"));
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::error::DockboltError;
    use crate::types::{
        ContainerInspect, ContainerRow, EngineEvent, ImageRow, NetworkRow, PruneDelta, RawLogChunk,
        VolumeRow,
    };
    use async_trait::async_trait;
    use futures::Stream;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};

    fn container(id: &str, running: bool) -> ContainerRow {
        ContainerRow {
            id: id.into(),
            name: id.into(),
            image: "img".into(),
            image_id: String::new(),
            state: if running {
                "running".into()
            } else {
                "exited".into()
            },
            running,
            created_unix: 1,
            compose_project: None,
            compose_service: None,
            ports: vec![],
        }
    }

    struct Mock {
        containers: Vec<ContainerRow>,
        images: Vec<ImageRow>,
        networks: Vec<NetworkRow>,
        used: Vec<String>,
        fail_images: bool,
        calls: Arc<Mutex<Vec<String>>>,
    }

    #[async_trait]
    impl DockerPort for Mock {
        async fn version(&self) -> Result<String, DockboltError> {
            Ok("1".into())
        }
        async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
            Ok(self.containers.clone())
        }
        async fn inspect_container(&self, _id: &str) -> Result<ContainerInspect, DockboltError> {
            Ok(ContainerInspect {
                id: "c".into(),
                name: "c".into(),
                image: "img".into(),
                state: "running".into(),
                created: String::new(),
                ports: vec![],
                mounts: vec![],
                networks: self.used.clone(),
                restart_policy: "no".into(),
                env: vec![],
            })
        }
        async fn remove_container(&self, _id: &str, _force: bool) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn start_container(&self, _id: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn stop_container(&self, _id: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn restart_container(&self, _id: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn list_networks(&self) -> Result<Vec<NetworkRow>, DockboltError> {
            Ok(self.networks.clone())
        }
        async fn remove_network(&self, _id: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError> {
            Ok(self.images.clone())
        }
        async fn remove_image(&self, _id: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_volume(&self, _name: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn prune_stopped_containers(&self) -> Result<PruneDelta, DockboltError> {
            self.calls.lock().unwrap().push("containers".into());
            Ok(PruneDelta {
                deleted: 2,
                space_reclaimed_bytes: 10,
            })
        }
        async fn prune_dangling_images(&self) -> Result<PruneDelta, DockboltError> {
            self.calls.lock().unwrap().push("images".into());
            if self.fail_images {
                return Err(DockboltError::Internal("images prune failed".into()));
            }
            Ok(PruneDelta {
                deleted: 1,
                space_reclaimed_bytes: 5,
            })
        }
        async fn prune_unused_networks(&self) -> Result<PruneDelta, DockboltError> {
            self.calls.lock().unwrap().push("networks".into());
            Ok(PruneDelta {
                deleted: 3,
                space_reclaimed_bytes: 0,
            })
        }
        fn logs(
            &self,
            _container_id: &str,
        ) -> Pin<Box<dyn Stream<Item = Result<RawLogChunk, DockboltError>> + Send>> {
            Box::pin(futures::stream::empty())
        }
        fn events(&self) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>> {
            Box::pin(futures::stream::empty())
        }
    }

    #[tokio::test]
    async fn preview_counts_stopped_dangling_and_unused() {
        let docker = Mock {
            containers: vec![container("a", true), container("b", false)],
            images: vec![
                ImageRow {
                    id: "1".into(),
                    tags: vec!["app:latest".into()],
                    size_bytes: 1,
                    created_unix: 1,
                    in_use: false,
                },
                ImageRow {
                    id: "2".into(),
                    tags: vec![],
                    size_bytes: 1,
                    created_unix: 1,
                    in_use: false,
                },
            ],
            networks: vec![
                NetworkRow {
                    id: "b".into(),
                    name: "bridge".into(),
                    driver: "bridge".into(),
                    scope: "local".into(),
                    compose_project: None,
                },
                NetworkRow {
                    id: "u".into(),
                    name: "unused".into(),
                    driver: "bridge".into(),
                    scope: "local".into(),
                    compose_project: None,
                },
                NetworkRow {
                    id: "k".into(),
                    name: "keep".into(),
                    driver: "bridge".into(),
                    scope: "local".into(),
                    compose_project: None,
                },
            ],
            used: vec!["keep".into()],
            fail_images: false,
            calls: Arc::new(Mutex::new(vec![])),
        };
        let preview = prune_preview(&docker).await.unwrap();
        assert_eq!(preview.stopped_containers, 1);
        assert_eq!(preview.dangling_images, 1);
        assert_eq!(preview.unused_networks, 1);
    }

    #[tokio::test]
    async fn run_prune_calls_each_type_and_keeps_going_after_error() {
        let calls = Arc::new(Mutex::new(vec![]));
        let docker = Mock {
            containers: vec![],
            images: vec![],
            networks: vec![],
            used: vec![],
            fail_images: true,
            calls: calls.clone(),
        };
        let report = run_prune(&docker).await.unwrap();
        assert_eq!(
            *calls.lock().unwrap(),
            vec!["containers", "images", "networks"]
        );
        assert_eq!(report.containers_deleted, 2);
        assert_eq!(report.images_deleted, 0);
        assert_eq!(report.networks_deleted, 3);
        assert_eq!(report.space_reclaimed_bytes, 10);
        assert!(report
            .error
            .as_deref()
            .unwrap()
            .contains("images prune failed"));
    }
}
