use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::{ContainerRow, ImageRow};

pub fn sort_images(rows: &mut [ImageRow]) {
    rows.sort_by(|a, b| {
        let ak = a.tags.first().cloned().unwrap_or_else(|| a.id.clone());
        let bk = b.tags.first().cloned().unwrap_or_else(|| b.id.clone());
        ak.cmp(&bk)
    });
}

fn digest(id: &str) -> &str {
    id.strip_prefix("sha256:").unwrap_or(id)
}

fn ids_match(image_id: &str, container_ref: &str) -> bool {
    let a = digest(image_id);
    let b = digest(container_ref);
    if a.is_empty() || b.is_empty() {
        return false;
    }
    a == b || a.starts_with(b) || b.starts_with(a)
}

fn container_uses_image(image: &ImageRow, container: &ContainerRow) -> bool {
    ids_match(&image.id, &container.image_id)
        || ids_match(&image.id, &container.image)
        || image.tags.iter().any(|tag| tag == &container.image)
}

pub fn classify_images(images: &mut [ImageRow], containers: &[ContainerRow]) {
    for image in images.iter_mut() {
        image.in_use = containers
            .iter()
            .any(|container| container_uses_image(image, container));
    }
}

pub async fn delete_image(docker: &dyn DockerPort, id: &str) -> Result<(), DockboltError> {
    docker.remove_image(id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{ContainerRow, EngineEvent, NetworkRow, RawLogChunk, VolumeRow};
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
    async fn image_in_use_is_not_retried_with_force() {
        let err = delete_image(&InUse, "sha").await.unwrap_err();
        assert_eq!(err.code(), "in_use");
    }
}

#[cfg(test)]
mod classify_tests {
    use super::*;
    use crate::types::ContainerRow;

    fn image(id: &str, tags: &[&str]) -> ImageRow {
        ImageRow {
            id: id.into(),
            tags: tags.iter().map(|t| (*t).to_string()).collect(),
            size_bytes: 1,
            created_unix: 0,
            in_use: false,
        }
    }

    fn container(image: &str, image_id: &str) -> ContainerRow {
        ContainerRow {
            id: "c1".into(),
            name: "c".into(),
            image: image.into(),
            image_id: image_id.into(),
            state: "exited".into(),
            running: false,
            created_unix: 0,
            compose_project: None,
            compose_service: None,
        }
    }

    #[test]
    fn marks_by_image_id_including_stopped() {
        let mut rows = vec![
            image("sha256:aaa111", &["mysql:8.0"]),
            image("sha256:bbb222", &["redis:latest"]),
        ];
        classify_images(&mut rows, &[container("mysql:8.0", "sha256:aaa111")]);
        assert!(rows[0].in_use);
        assert!(!rows[1].in_use);
    }

    #[test]
    fn marks_by_tag_when_id_missing() {
        let mut rows = vec![image("sha256:aaa111", &["mysql:8.0"])];
        classify_images(&mut rows, &[container("mysql:8.0", "")]);
        assert!(rows[0].in_use);
    }

    #[test]
    fn matches_short_and_prefixed_ids() {
        let mut rows = vec![image("sha256:abcdef0123456789", &[])];
        classify_images(
            &mut rows,
            &[container("sha256:abcdef0123456789", "abcdef012345")],
        );
        assert!(rows[0].in_use);
    }
}
