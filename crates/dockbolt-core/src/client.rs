use std::pin::Pin;

use async_trait::async_trait;
use futures::Stream;

use crate::error::DockboltError;
use crate::types::{
    ContainerInspect, ContainerRow, EngineEvent, ImageRow, NetworkRow, RawLogChunk, VolumeRow,
};

#[async_trait]
pub trait DockerPort: Send + Sync {
    async fn version(&self) -> Result<String, DockboltError>;
    async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError>;
    async fn inspect_container(&self, id: &str) -> Result<ContainerInspect, DockboltError> {
        let _ = id;
        Err(DockboltError::Internal("inspect not implemented".into()))
    }
    async fn remove_container(&self, id: &str, force: bool) -> Result<(), DockboltError>;
    async fn start_container(&self, id: &str) -> Result<(), DockboltError>;
    async fn stop_container(&self, id: &str) -> Result<(), DockboltError>;
    async fn restart_container(&self, id: &str) -> Result<(), DockboltError>;
    async fn list_networks(&self) -> Result<Vec<NetworkRow>, DockboltError>;
    async fn remove_network(&self, id: &str) -> Result<(), DockboltError>;
    async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError>;
    async fn remove_image(&self, id: &str) -> Result<(), DockboltError>;
    async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError>;
    async fn remove_volume(&self, name: &str) -> Result<(), DockboltError>;
    fn logs(
        &self,
        container_id: &str,
    ) -> Pin<Box<dyn Stream<Item = Result<RawLogChunk, DockboltError>> + Send>>;
    fn events(&self) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>>;
}

pub async fn ping(docker: &dyn DockerPort) -> Result<String, DockboltError> {
    match tokio::time::timeout(std::time::Duration::from_millis(100), docker.version()).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(DockboltError::Timeout),
    }
}

#[cfg(test)]
mod ping_tests {
    use super::*;
    use crate::types::{ContainerRow, EngineEvent, ImageRow, NetworkRow, RawLogChunk, VolumeRow};
    use async_trait::async_trait;
    use futures::Stream;
    use std::pin::Pin;
    use std::time::Duration;

    struct SleepyVersion;

    #[async_trait]
    impl DockerPort for SleepyVersion {
        async fn version(&self) -> Result<String, DockboltError> {
            tokio::time::sleep(Duration::from_millis(200)).await;
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
            Ok(())
        }
        async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_volume(&self, _name: &str) -> Result<(), DockboltError> {
            Ok(())
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
    async fn ping_times_out_when_version_is_slow() {
        let err = ping(&SleepyVersion).await.unwrap_err();
        assert_eq!(err.code(), "timeout");
    }

    #[tokio::test]
    async fn start_stop_network_defaults_succeed_on_sleepy_version() {
        let d = SleepyVersion;
        d.start_container("x").await.unwrap();
        d.stop_container("x").await.unwrap();
        assert!(d.list_networks().await.unwrap().is_empty());
        d.remove_network("n").await.unwrap();
    }
}
