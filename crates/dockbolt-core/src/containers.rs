use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::ContainerRow;

pub fn normalize_container_name(names: &[String], id: &str) -> String {
    if let Some(raw) = names.first() {
        let trimmed = raw.trim_start_matches('/');
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    id.chars().take(12).collect()
}

pub fn sort_containers(rows: &mut [ContainerRow]) {
    rows.sort_by(|a, b| b.running.cmp(&a.running).then_with(|| a.name.cmp(&b.name)));
}

pub fn force_for_container_delete(running: bool) -> bool {
    running
}

pub async fn delete_container(
    docker: &dyn DockerPort,
    row: &ContainerRow,
) -> Result<(), DockboltError> {
    docker
        .remove_container(&row.id, force_for_container_delete(row.running))
        .await
}

#[cfg(test)]
mod delete_tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{EngineEvent, ImageRow, RawLogChunk, VolumeRow};
    use async_trait::async_trait;
    use futures::Stream;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};

    struct Mock {
        last_force: Arc<Mutex<Option<bool>>>,
    }

    #[async_trait]
    impl DockerPort for Mock {
        async fn version(&self) -> Result<String, DockboltError> {
            Ok("1".into())
        }
        async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_container(&self, _id: &str, force: bool) -> Result<(), DockboltError> {
            *self.last_force.lock().unwrap() = Some(force);
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
        fn events(
            &self,
        ) -> Pin<Box<dyn Stream<Item = Result<EngineEvent, DockboltError>> + Send>> {
            Box::pin(futures::stream::empty())
        }
    }

    #[tokio::test]
    async fn running_delete_uses_force() {
        let last = Arc::new(Mutex::new(None));
        let docker = Mock {
            last_force: last.clone(),
        };
        let row = ContainerRow {
            id: "abc".into(),
            name: "api".into(),
            image: "img".into(),
            image_id: String::new(),
            state: "running".into(),
            running: true,
            created_unix: 1,
        };
        delete_container(&docker, &row).await.unwrap();
        assert_eq!(*last.lock().unwrap(), Some(true));
    }

    #[tokio::test]
    async fn stopped_delete_does_not_force() {
        let last = Arc::new(Mutex::new(None));
        let docker = Mock {
            last_force: last.clone(),
        };
        let row = ContainerRow {
            id: "abc".into(),
            name: "api".into(),
            image: "img".into(),
            image_id: String::new(),
            state: "exited".into(),
            running: false,
            created_unix: 1,
        };
        delete_container(&docker, &row).await.unwrap();
        assert_eq!(*last.lock().unwrap(), Some(false));
    }
}
