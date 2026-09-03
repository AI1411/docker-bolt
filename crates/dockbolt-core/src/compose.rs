use std::collections::{BTreeMap, HashSet};

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

#[cfg(test)]
mod grouping_tests {
    use crate::types::{ComposeProjectStatus, ContainerRow};

    use super::build_compose_projects;

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
            state: if running { "running".into() } else { "exited".into() },
            running,
            created_unix: 0,
            compose_project: project.map(|s| s.to_string()),
            compose_service: service.map(|s| s.to_string()),
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
}
