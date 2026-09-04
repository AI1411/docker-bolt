use crate::client::DockerPort;
use crate::error::DockboltError;
use crate::types::NetworkRow;

pub fn is_system_network(name: &str) -> bool {
    matches!(name, "bridge" | "host" | "none")
}

pub fn sort_networks(rows: &mut [NetworkRow]) {
    rows.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
}

pub async fn delete_network(
    docker: &dyn DockerPort,
    row: &NetworkRow,
) -> Result<(), DockboltError> {
    if is_system_network(&row.name) {
        return Err(DockboltError::Conflict(format!(
            "{} is a system network and cannot be deleted",
            row.name
        )));
    }
    docker.remove_network(&row.id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::DockerPort;
    use crate::types::{ContainerRow, EngineEvent, ImageRow, RawLogChunk, VolumeRow};
    use async_trait::async_trait;
    use futures::Stream;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};

    struct Mock {
        removed: Arc<Mutex<Vec<String>>>,
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
        async fn remove_network(&self, id: &str) -> Result<(), DockboltError> {
            self.removed.lock().unwrap().push(id.into());
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

    fn row(name: &str) -> NetworkRow {
        NetworkRow {
            id: format!("id-{name}"),
            name: name.into(),
            driver: "bridge".into(),
            scope: "local".into(),
            compose_project: None,
        }
    }

    #[test]
    fn system_networks_are_bridge_host_none() {
        assert!(is_system_network("bridge"));
        assert!(is_system_network("host"));
        assert!(is_system_network("none"));
        assert!(!is_system_network("app_default"));
    }

    #[tokio::test]
    async fn system_delete_is_rejected_without_engine_call() {
        let removed = Arc::new(Mutex::new(vec![]));
        let err = delete_network(
            &Mock {
                removed: removed.clone(),
            },
            &row("bridge"),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code(), "conflict");
        assert!(removed.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn user_network_delete_calls_engine() {
        let removed = Arc::new(Mutex::new(vec![]));
        delete_network(
            &Mock {
                removed: removed.clone(),
            },
            &row("app_default"),
        )
        .await
        .unwrap();
        assert_eq!(*removed.lock().unwrap(), vec!["id-app_default"]);
    }
}
