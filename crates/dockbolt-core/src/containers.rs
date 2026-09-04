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

pub async fn start_container(docker: &dyn DockerPort, id: &str) -> Result<(), DockboltError> {
    docker.start_container(id).await
}

pub async fn stop_container(docker: &dyn DockerPort, id: &str) -> Result<(), DockboltError> {
    docker.stop_container(id).await
}

pub async fn restart_container(docker: &dyn DockerPort, id: &str) -> Result<(), DockboltError> {
    docker.restart_container(id).await
}

#[cfg(test)]
mod delete_tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{EngineEvent, ImageRow, NetworkRow, RawLogChunk, VolumeRow};
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
            compose_project: None,
            compose_service: None,
            ports: vec![],
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
            compose_project: None,
            compose_service: None,
            ports: vec![],
        };
        delete_container(&docker, &row).await.unwrap();
        assert_eq!(*last.lock().unwrap(), Some(false));
    }
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{EngineEvent, ImageRow, NetworkRow, RawLogChunk, VolumeRow};
    use async_trait::async_trait;
    use futures::Stream;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};

    struct Mock {
        last: Arc<Mutex<Option<String>>>,
        fail: bool,
    }

    #[async_trait]
    impl DockerPort for Mock {
        async fn version(&self) -> Result<String, DockboltError> {
            Ok("1".into())
        }
        async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
            Ok(vec![])
        }
        async fn remove_container(&self, _id: &str, _force: bool) -> Result<(), DockboltError> {
            Ok(())
        }
        async fn start_container(&self, id: &str) -> Result<(), DockboltError> {
            *self.last.lock().unwrap() = Some(format!("start:{id}"));
            if self.fail {
                return Err(DockboltError::Internal("cannot start".into()));
            }
            Ok(())
        }
        async fn stop_container(&self, id: &str) -> Result<(), DockboltError> {
            *self.last.lock().unwrap() = Some(format!("stop:{id}"));
            Ok(())
        }
        async fn restart_container(&self, id: &str) -> Result<(), DockboltError> {
            *self.last.lock().unwrap() = Some(format!("restart:{id}"));
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
    async fn start_stop_restart_call_engine() {
        let last = Arc::new(Mutex::new(None));
        let docker = Mock {
            last: last.clone(),
            fail: false,
        };
        start_container(&docker, "abc").await.unwrap();
        assert_eq!(last.lock().unwrap().as_deref(), Some("start:abc"));
        stop_container(&docker, "abc").await.unwrap();
        assert_eq!(last.lock().unwrap().as_deref(), Some("stop:abc"));
        restart_container(&docker, "abc").await.unwrap();
        assert_eq!(last.lock().unwrap().as_deref(), Some("restart:abc"));
    }

    #[tokio::test]
    async fn start_error_is_returned() {
        let docker = Mock {
            last: Arc::new(Mutex::new(None)),
            fail: true,
        };
        let err = start_container(&docker, "abc").await.unwrap_err();
        assert_eq!(err.code(), "internal");
    }
}
