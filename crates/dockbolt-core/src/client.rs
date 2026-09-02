use std::pin::Pin;

use async_trait::async_trait;
use futures::Stream;

use crate::error::DockboltError;
use crate::types::{
    ContainerRow, EngineEvent, ImageRow, RawLogChunk, VolumeRow,
};

#[async_trait]
pub trait DockerPort: Send + Sync {
    async fn version(&self) -> Result<String, DockboltError>;
    async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError>;
    async fn remove_container(&self, id: &str, force: bool) -> Result<(), DockboltError>;
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
