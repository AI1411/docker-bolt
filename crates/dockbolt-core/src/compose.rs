use std::collections::{BTreeMap, HashSet};

use crate::client::DockerPort;
use crate::containers::force_for_container_delete;
use crate::error::DockboltError;
use crate::types::{ComposeProjectRow, ComposeProjectStatus, ContainerRow};

pub fn build_compose_projects(containers: &[ContainerRow]) -> Vec<ComposeProjectRow> {
    let mut grouped: BTreeMap<String, Vec<&ContainerRow>> = BTreeMap::new();
    for c in containers {
        if let Some(project) = c.compose_project.as_deref().filter(|s| !s.is_empty()) {
            grouped.entry(project.to_string()).or_default().push(c);
        }
    }
    let mut out: Vec<ComposeProjectRow> = grouped
        .into_iter()
        .map(|(project, members)| {
            let container_count = members.len() as u32;
            let running_count = members.iter().filter(|c| c.running).count() as u32;
            let status = if running_count == 0 {
                ComposeProjectStatus::Stopped
            } else if running_count == container_count {
                ComposeProjectStatus::Running
            } else {
                ComposeProjectStatus::Partial
            };
            let mut named = HashSet::new();
            let mut unlabeled = 0u32;
            for c in &members {
                match c.compose_service.as_deref().filter(|s| !s.is_empty()) {
                    Some(svc) => {
                        named.insert(svc);
                    }
                    None => unlabeled += 1,
                }
            }
            ComposeProjectRow {
                project,
                status,
                service_count: named.len() as u32 + unlabeled,
                running_count,
                container_count,
            }
        })
        .collect();
    out.sort_by(|a, b| a.project.to_lowercase().cmp(&b.project.to_lowercase()));
    out
}

fn project_containers<'a>(containers: &'a [ContainerRow], project: &str) -> Vec<&'a ContainerRow> {
    let mut members: Vec<_> = containers
        .iter()
        .filter(|c| c.compose_project.as_deref() == Some(project))
        .collect();
    members.sort_by(|a, b| a.name.cmp(&b.name));
    members
}

fn first_error(errors: Vec<DockboltError>) -> Result<(), DockboltError> {
    match errors.into_iter().next() {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

pub async fn list_compose_projects(
    docker: &dyn DockerPort,
) -> Result<Vec<ComposeProjectRow>, DockboltError> {
    Ok(build_compose_projects(&docker.list_containers().await?))
}

pub async fn start_compose_project(
    docker: &dyn DockerPort,
    project: &str,
) -> Result<(), DockboltError> {
    let containers = docker.list_containers().await?;
    let members = project_containers(&containers, project);
    if members.is_empty() {
        return Err(DockboltError::NotFound(project.to_string()));
    }

    let mut errors = Vec::new();
    for container in members {
        if !container.running {
            if let Err(error) = docker.start_container(&container.id).await {
                errors.push(error);
            }
        }
    }
    first_error(errors)
}

pub async fn stop_compose_project(
    docker: &dyn DockerPort,
    project: &str,
) -> Result<(), DockboltError> {
    let containers = docker.list_containers().await?;
    let members = project_containers(&containers, project);
    if members.is_empty() {
        return Err(DockboltError::NotFound(project.to_string()));
    }

    let mut errors = Vec::new();
    for container in members {
        if container.running {
            if let Err(error) = docker.stop_container(&container.id).await {
                errors.push(error);
            }
        }
    }
    first_error(errors)
}

pub async fn down_compose_project(
    docker: &dyn DockerPort,
    project: &str,
) -> Result<(), DockboltError> {
    let containers = docker.list_containers().await?;
    let members = project_containers(&containers, project);
    if members.is_empty() {
        return Err(DockboltError::NotFound(project.to_string()));
    }

    let mut errors = Vec::new();
    for container in members {
        if container.running {
            if let Err(error) = docker.stop_container(&container.id).await {
                errors.push(error);
            }
        }
        if let Err(error) = docker
            .remove_container(&container.id, force_for_container_delete(container.running))
            .await
        {
            errors.push(error);
        }
    }

    match docker.list_networks().await {
        Ok(networks) => {
            let mut project_networks: Vec<_> = networks
                .iter()
                .filter(|network| network.compose_project.as_deref() == Some(project))
                .collect();
            project_networks.sort_by(|a, b| a.name.cmp(&b.name));
            for network in project_networks {
                let identifier = if network.id.is_empty() {
                    &network.name
                } else {
                    &network.id
                };
                if let Err(error) = docker.remove_network(identifier).await {
                    errors.push(error);
                }
            }
        }
        Err(error) => errors.push(error),
    }

    first_error(errors)
}

#[cfg(test)]
mod grouping_tests {
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use futures::Stream;

    use crate::client::DockerPort;
    use crate::error::DockboltError;
    use crate::types::{
        ComposeProjectStatus, ContainerRow, EngineEvent, ImageRow, NetworkRow, RawLogChunk,
        VolumeRow,
    };

    use super::{
        build_compose_projects, down_compose_project, list_compose_projects, start_compose_project,
        stop_compose_project,
    };

    fn row(
        id: &str,
        name: &str,
        running: bool,
        project: Option<&str>,
        service: Option<&str>,
    ) -> ContainerRow {
        ContainerRow {
            id: id.into(),
            name: name.into(),
            image: "img".into(),
            image_id: String::new(),
            state: if running {
                "running".into()
            } else {
                "exited".into()
            },
            running,
            created_unix: 0,
            compose_project: project.map(|s| s.to_string()),
            compose_service: service.map(|s| s.to_string()),
        }
    }

    fn network(id: &str, name: &str, project: Option<&str>) -> NetworkRow {
        NetworkRow {
            id: id.into(),
            name: name.into(),
            compose_project: project.map(str::to_string),
        }
    }

    struct Recording {
        containers: Vec<ContainerRow>,
        networks: Vec<NetworkRow>,
        start: Arc<Mutex<Vec<String>>>,
        stop: Arc<Mutex<Vec<String>>>,
        remove_c: Arc<Mutex<Vec<(String, bool)>>>,
        remove_n: Arc<Mutex<Vec<String>>>,
        volume_touch: Arc<Mutex<u32>>,
        fail_start: Option<String>,
    }

    #[async_trait]
    impl DockerPort for Recording {
        async fn version(&self) -> Result<String, DockboltError> {
            Ok("1".into())
        }

        async fn list_containers(&self) -> Result<Vec<ContainerRow>, DockboltError> {
            Ok(self.containers.clone())
        }

        async fn remove_container(&self, id: &str, force: bool) -> Result<(), DockboltError> {
            self.remove_c.lock().unwrap().push((id.to_string(), force));
            Ok(())
        }

        async fn start_container(&self, id: &str) -> Result<(), DockboltError> {
            self.start.lock().unwrap().push(id.to_string());
            if self.fail_start.as_deref() == Some(id) {
                return Err(DockboltError::Internal("boom".into()));
            }
            Ok(())
        }

        async fn stop_container(&self, id: &str) -> Result<(), DockboltError> {
            self.stop.lock().unwrap().push(id.to_string());
            Ok(())
        }

        async fn list_networks(&self) -> Result<Vec<NetworkRow>, DockboltError> {
            Ok(self.networks.clone())
        }

        async fn remove_network(&self, id: &str) -> Result<(), DockboltError> {
            self.remove_n.lock().unwrap().push(id.to_string());
            Ok(())
        }

        async fn list_images(&self) -> Result<Vec<ImageRow>, DockboltError> {
            Ok(vec![])
        }

        async fn remove_image(&self, _id: &str) -> Result<(), DockboltError> {
            Ok(())
        }

        async fn list_volumes(&self) -> Result<Vec<VolumeRow>, DockboltError> {
            *self.volume_touch.lock().unwrap() += 1;
            Ok(vec![])
        }

        async fn remove_volume(&self, _name: &str) -> Result<(), DockboltError> {
            *self.volume_touch.lock().unwrap() += 1;
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

    #[test]
    fn skips_unlabeled() {
        let rows = vec![row("a", "plain", true, None, None)];
        assert!(build_compose_projects(&rows).is_empty());
    }

    #[test]
    fn includes_stopped() {
        let rows = vec![row("a", "web", false, Some("app"), Some("web"))];
        let out = build_compose_projects(&rows);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].project, "app");
        assert_eq!(out[0].status, ComposeProjectStatus::Stopped);
        assert_eq!(out[0].running_count, 0);
        assert_eq!(out[0].container_count, 1);
    }

    #[test]
    fn status_running_partial_stopped() {
        let running = vec![
            row("1", "a", true, Some("p"), Some("web")),
            row("2", "b", true, Some("p"), Some("db")),
        ];
        assert_eq!(
            build_compose_projects(&running)[0].status,
            ComposeProjectStatus::Running
        );
        let mixed = vec![
            row("1", "a", true, Some("p"), Some("web")),
            row("2", "b", false, Some("p"), Some("db")),
        ];
        assert_eq!(
            build_compose_projects(&mixed)[0].status,
            ComposeProjectStatus::Partial
        );
        let stopped = vec![
            row("1", "a", false, Some("p"), Some("web")),
            row("2", "b", false, Some("p"), Some("db")),
        ];
        assert_eq!(
            build_compose_projects(&stopped)[0].status,
            ComposeProjectStatus::Stopped
        );
    }

    #[test]
    fn service_count_unique_plus_unlabeled() {
        let rows = vec![
            row("1", "a", true, Some("p"), Some("web")),
            row("2", "b", true, Some("p"), Some("web")),
            row("3", "c", true, Some("p"), Some("db")),
            row("4", "d", true, Some("p"), None),
        ];
        assert_eq!(build_compose_projects(&rows)[0].service_count, 3);
    }

    #[test]
    fn sorts_projects_case_insensitive() {
        let rows = vec![
            row("1", "a", false, Some("Zoo"), Some("a")),
            row("2", "b", false, Some("alpha"), Some("a")),
        ];
        let names: Vec<_> = build_compose_projects(&rows)
            .into_iter()
            .map(|p| p.project)
            .collect();
        assert_eq!(names, vec!["alpha", "Zoo"]);
    }

    #[tokio::test]
    async fn list_returns_built_compose_projects() {
        let docker = Recording {
            containers: vec![row("a", "web", true, Some("p"), Some("web"))],
            networks: vec![],
            start: Arc::new(Mutex::new(vec![])),
            stop: Arc::new(Mutex::new(vec![])),
            remove_c: Arc::new(Mutex::new(vec![])),
            remove_n: Arc::new(Mutex::new(vec![])),
            volume_touch: Arc::new(Mutex::new(0)),
            fail_start: None,
        };

        let projects = list_compose_projects(&docker).await.unwrap();

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project, "p");
    }

    #[tokio::test]
    async fn start_only_stopped() {
        let docker = Recording {
            containers: vec![
                row("run", "b-run", true, Some("p"), Some("web")),
                row("stop", "a-stop", false, Some("p"), Some("db")),
            ],
            networks: vec![],
            start: Arc::new(Mutex::new(vec![])),
            stop: Arc::new(Mutex::new(vec![])),
            remove_c: Arc::new(Mutex::new(vec![])),
            remove_n: Arc::new(Mutex::new(vec![])),
            volume_touch: Arc::new(Mutex::new(0)),
            fail_start: None,
        };

        start_compose_project(&docker, "p").await.unwrap();

        assert_eq!(*docker.start.lock().unwrap(), vec!["stop".to_string()]);
    }

    #[tokio::test]
    async fn stop_only_running() {
        let docker = Recording {
            containers: vec![
                row("stop", "b-stop", false, Some("p"), Some("db")),
                row("run", "a-run", true, Some("p"), Some("web")),
            ],
            networks: vec![],
            start: Arc::new(Mutex::new(vec![])),
            stop: Arc::new(Mutex::new(vec![])),
            remove_c: Arc::new(Mutex::new(vec![])),
            remove_n: Arc::new(Mutex::new(vec![])),
            volume_touch: Arc::new(Mutex::new(0)),
            fail_start: None,
        };

        stop_compose_project(&docker, "p").await.unwrap();

        assert_eq!(*docker.stop.lock().unwrap(), vec!["run".to_string()]);
    }

    #[tokio::test]
    async fn down_removes_project_networks_not_volumes_or_other_projects() {
        let docker = Recording {
            containers: vec![
                row("run", "a-run", true, Some("p"), Some("web")),
                row("stop", "b-stop", false, Some("p"), Some("db")),
                row("other", "c-other", true, Some("q"), Some("web")),
            ],
            networks: vec![
                network("n1", "p_default", Some("p")),
                network("n2", "q_default", Some("q")),
                network("n3", "plain", None),
            ],
            start: Arc::new(Mutex::new(vec![])),
            stop: Arc::new(Mutex::new(vec![])),
            remove_c: Arc::new(Mutex::new(vec![])),
            remove_n: Arc::new(Mutex::new(vec![])),
            volume_touch: Arc::new(Mutex::new(0)),
            fail_start: None,
        };

        down_compose_project(&docker, "p").await.unwrap();

        assert_eq!(*docker.stop.lock().unwrap(), vec!["run".to_string()]);
        assert_eq!(
            *docker.remove_c.lock().unwrap(),
            vec![("run".to_string(), true), ("stop".to_string(), false)]
        );
        assert_eq!(*docker.remove_n.lock().unwrap(), vec!["n1".to_string()]);
        assert_eq!(*docker.volume_touch.lock().unwrap(), 0);
    }

    #[tokio::test]
    async fn start_partial_failure_still_starts_both() {
        let docker = Recording {
            containers: vec![
                row("a", "a", false, Some("p"), Some("web")),
                row("b", "b", false, Some("p"), Some("db")),
            ],
            networks: vec![],
            start: Arc::new(Mutex::new(vec![])),
            stop: Arc::new(Mutex::new(vec![])),
            remove_c: Arc::new(Mutex::new(vec![])),
            remove_n: Arc::new(Mutex::new(vec![])),
            volume_touch: Arc::new(Mutex::new(0)),
            fail_start: Some("b".into()),
        };

        let err = start_compose_project(&docker, "p").await.unwrap_err();

        assert_eq!(err.code(), "internal");
        assert_eq!(
            *docker.start.lock().unwrap(),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[tokio::test]
    async fn missing_project_does_not_touch_docker() {
        let docker = Recording {
            containers: vec![row("a", "a", false, Some("p"), Some("web"))],
            networks: vec![],
            start: Arc::new(Mutex::new(vec![])),
            stop: Arc::new(Mutex::new(vec![])),
            remove_c: Arc::new(Mutex::new(vec![])),
            remove_n: Arc::new(Mutex::new(vec![])),
            volume_touch: Arc::new(Mutex::new(0)),
            fail_start: None,
        };

        let err = start_compose_project(&docker, "nope").await.unwrap_err();

        assert_eq!(err.code(), "not_found");
        assert!(matches!(err, DockboltError::NotFound(ref name) if name == "nope"));
        assert!(docker.start.lock().unwrap().is_empty());
    }
}
