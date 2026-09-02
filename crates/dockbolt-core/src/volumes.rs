use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::VolumeRow;

pub fn sort_volumes(rows: &mut [VolumeRow]) {
    rows.sort_by(|a, b| a.name.cmp(&b.name));
}

pub async fn delete_volume(docker: &dyn DockerPort, name: &str) -> Result<(), DockboltError> {
    docker.remove_volume(name).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{ContainerRow, EngineEvent, ImageRow, RawLogChunk};
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
        fn events(
            &self,
        ) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>> {
            Box::pin(futures::stream::empty())
        }
    }

    #[tokio::test]
    async fn volume_in_use_is_not_retried_with_force() {
        let err = delete_volume(&InUse, "data").await.unwrap_err();
        assert_eq!(err.code(), "in_use");
    }
}
