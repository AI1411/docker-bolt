use std::collections::HashSet;

use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::{InspectMount, VolumeRow};

pub fn sort_volumes(rows: &mut [VolumeRow]) {
    rows.sort_by(|a, b| a.name.cmp(&b.name));
}

pub fn named_volume_from_mount(mount: &InspectMount) -> Option<String> {
    let name = mount.name.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

pub fn classify_volumes(volumes: &mut [VolumeRow], used: Option<&HashSet<String>>) {
    match used {
        None => {
            for volume in volumes {
                volume.in_use = true;
            }
        }
        Some(names) => {
            for volume in volumes {
                volume.in_use = names.contains(&volume.name);
            }
        }
    }
}

pub async fn list_classified_volumes(
    docker: &dyn DockerPort,
) -> Result<Vec<VolumeRow>, DockboltError> {
    let mut rows = docker.list_volumes().await?;
    let containers = docker.list_containers().await?;
    let mut used = HashSet::new();
    let mut unknown = false;
    for container in containers {
        match docker.inspect_container(&container.id).await {
            Ok(info) => {
                for mount in info.mounts {
                    if let Some(name) = named_volume_from_mount(&mount) {
                        used.insert(name);
                    }
                }
            }
            Err(_) => {
                unknown = true;
                break;
            }
        }
    }
    classify_volumes(&mut rows, if unknown { None } else { Some(&used) });
    sort_volumes(&mut rows);
    Ok(rows)
}

pub async fn delete_volume(docker: &dyn DockerPort, name: &str) -> Result<(), DockboltError> {
    docker.remove_volume(name).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{ContainerRow, EngineEvent, ImageRow, NetworkRow, RawLogChunk};
    use async_trait::async_trait;
    use futures::Stream;
    use std::pin::Pin;

    struct InUse;

    #[async_trait]
    impl DockerPort for InUse {
        async fn version(&self) -> Result<String, DockboltError> {
            Ok("1".into())
        }
        async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
            Ok(vec![])
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
            Ok(vec![])
        }
        async fn remove_network(&self, _id: &str) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_image(&self, _id: &str) -> Result<(), DockboltError> {
            Err(DockboltError::InUse {
                summary: "image used by container".into(),
            })
        }
        async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_volume(&self, _name: &str) -> Result<(), DockboltError> {
            Err(DockboltError::InUse {
                summary: "volume in use".into(),
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
    async fn volume_in_use_is_not_retried_with_force() {
        let err = delete_volume(&InUse, "data").await.unwrap_err();
        assert_eq!(err.code(), "in_use");
    }

    #[test]
    fn unknown_usage_treats_every_volume_as_in_use() {
        let mut rows = vec![VolumeRow {
            name: "a".into(),
            driver: "local".into(),
            in_use: false,
        }];
        classify_volumes(&mut rows, None);
        assert!(rows[0].in_use);
    }

    #[test]
    fn unused_volume_is_not_referenced_by_mount_name() {
        let mut rows = vec![
            VolumeRow {
                name: "data".into(),
                driver: "local".into(),
                in_use: false,
            },
            VolumeRow {
                name: "tmp".into(),
                driver: "local".into(),
                in_use: false,
            },
        ];
        let used = std::collections::HashSet::from(["data".to_string()]);
        classify_volumes(&mut rows, Some(&used));
        assert!(rows[0].in_use);
        assert!(!rows[1].in_use);
    }

    #[test]
    fn named_mount_uses_inspect_name() {
        assert_eq!(
            named_volume_from_mount(&crate::types::InspectMount {
                source: "/var/lib/docker/volumes/data/_data".into(),
                destination: "/data".into(),
                name: "data".into(),
            })
            .as_deref(),
            Some("data")
        );
        assert_eq!(
            named_volume_from_mount(&crate::types::InspectMount {
                source: "/host".into(),
                destination: "/data".into(),
                name: String::new(),
            }),
            None
        );
    }
}
