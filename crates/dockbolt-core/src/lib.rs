pub mod bollard_client;
pub mod client;
pub mod containers;
pub mod events;
pub mod images;
pub mod volumes;
pub mod engine;
pub mod error;
pub mod logs;
pub mod types;

pub use client::DockerPort;
pub use engine::*;
pub use error::DockboltError;
pub use types::*;

pub fn core_version() -> &'static str {
    "0.1.0"
}

#[cfg(test)]
mod tests {
    use super::core_version;

    #[test]
    fn core_version_is_semver_prefix() {
        assert!(core_version().starts_with("0.1."));
    }
}

#[cfg(test)]
mod error_code_tests {
    use super::DockboltError;

    #[test]
    fn error_codes_match_spec() {
        assert_eq!(DockboltError::SocketNotFound.code(), "socket_not_found");
        assert_eq!(DockboltError::PermissionDenied.code(), "permission_denied");
        assert_eq!(DockboltError::Timeout.code(), "timeout");
        assert_eq!(
            DockboltError::EngineUnreachable("x".into()).code(),
            "engine_unreachable"
        );
        assert_eq!(DockboltError::NotFound("c".into()).code(), "not_found");
        assert_eq!(
            DockboltError::InUse {
                summary: "vol".into()
            }
            .code(),
            "in_use"
        );
        assert_eq!(DockboltError::Conflict("c".into()).code(), "conflict");
        assert_eq!(DockboltError::Internal("i".into()).code(), "internal");
    }
}

#[cfg(test)]
mod engine_tests {
    use crate::engine::{
        candidate_from_probe, engine_specs, select_engine_id, ENGINE_COLIMA_DEFAULT,
        ENGINE_DOCKER_DESKTOP, ENGINE_ORBSTACK, ENGINE_UNIX_DEFAULT,
    };
    use crate::DockboltError;

    #[test]
    fn specs_use_priority_order_and_home() {
        let specs = engine_specs("/Users/dev");
        let ids: Vec<_> = specs.iter().map(|s| s.engine_id).collect();
        assert_eq!(
            ids,
            [
                ENGINE_ORBSTACK,
                ENGINE_DOCKER_DESKTOP,
                ENGINE_COLIMA_DEFAULT,
                ENGINE_UNIX_DEFAULT
            ]
        );
        assert_eq!(specs[0].socket_path, "/Users/dev/.orbstack/run/docker.sock");
        assert_eq!(specs[1].socket_path, "/Users/dev/.docker/run/docker.sock");
        assert_eq!(
            specs[2].socket_path,
            "/Users/dev/.colima/default/docker.sock"
        );
        assert_eq!(specs[3].socket_path, "/var/run/docker.sock");
    }

    #[test]
    fn missing_path_is_unavailable() {
        let spec = &engine_specs("/h")[0];
        let c = candidate_from_probe(spec, false, Ok(()));
        assert!(!c.available);
        assert_eq!(c.unavailable_reason.as_deref(), Some("socket_not_found"));
    }

    #[test]
    fn ping_timeout_marks_unavailable() {
        let spec = &engine_specs("/h")[3];
        let c = candidate_from_probe(spec, true, Err(DockboltError::Timeout));
        assert!(!c.available);
        assert_eq!(c.unavailable_reason.as_deref(), Some("timeout"));
        assert_eq!(c.endpoint, "unix:///var/run/docker.sock");
    }

    #[test]
    fn prefer_saved_if_available() {
        let specs = engine_specs("/h");
        let mut orb = candidate_from_probe(&specs[0], true, Ok(()));
        let unix = candidate_from_probe(&specs[3], true, Ok(()));
        orb.available = true;
        let list = vec![orb.clone(), unix];
        assert_eq!(
            select_engine_id(Some(ENGINE_UNIX_DEFAULT), &list).as_deref(),
            Some(ENGINE_UNIX_DEFAULT)
        );
    }

    #[test]
    fn skip_dead_saved_and_use_priority() {
        let specs = engine_specs("/h");
        let mut orb = candidate_from_probe(&specs[0], true, Ok(()));
        let mut unix = candidate_from_probe(&specs[3], true, Err(DockboltError::Timeout));
        unix.available = false;
        orb.available = true;
        let list = vec![orb, unix];
        assert_eq!(
            select_engine_id(Some(ENGINE_UNIX_DEFAULT), &list).as_deref(),
            Some(ENGINE_ORBSTACK)
        );
    }

    #[test]
    fn none_when_all_down() {
        let specs = engine_specs("/h");
        let c = candidate_from_probe(&specs[0], false, Ok(()));
        assert_eq!(select_engine_id(None, &[c]), None);
    }
}

#[cfg(test)]
mod container_tests {
    use crate::containers::{
        force_for_container_delete, normalize_container_name, sort_containers,
    };
    use crate::ContainerRow;

    fn row(name: &str, running: bool) -> ContainerRow {
        ContainerRow {
            id: format!("id-{name}"),
            name: name.into(),
            image: "img".into(),
            state: if running { "running" } else { "exited" }.into(),
            running,
            created_unix: 0,
        }
    }

    #[test]
    fn strips_slash_and_falls_back_to_short_id() {
        assert_eq!(
            normalize_container_name(&["/api".into()], "abcdefghijklmnop"),
            "api"
        );
        assert_eq!(normalize_container_name(&[], "abcdefghijklmnop"), "abcdefghijkl");
    }

    #[test]
    fn running_sorts_before_name() {
        let mut rows = vec![row("b", false), row("a", false), row("z", true)];
        sort_containers(&mut rows);
        assert_eq!(
            rows.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            ["z", "a", "b"]
        );
    }

    #[test]
    fn force_only_when_running() {
        assert!(force_for_container_delete(true));
        assert!(!force_for_container_delete(false));
    }
}

#[cfg(test)]
mod image_volume_tests {
    use crate::images::sort_images;
    use crate::volumes::sort_volumes;
    use crate::{ImageRow, VolumeRow};

    #[test]
    fn images_sort_by_first_tag() {
        let mut rows = vec![
            ImageRow {
                id: "b".into(),
                tags: vec!["zeta".into()],
                size_bytes: 1,
                created_unix: 0,
            },
            ImageRow {
                id: "a".into(),
                tags: vec![],
                size_bytes: 1,
                created_unix: 0,
            },
        ];
        sort_images(&mut rows);
        assert_eq!(rows[0].id, "a");
        assert_eq!(rows[1].id, "b");
    }

    #[test]
    fn volumes_sort_by_name() {
        let mut rows = vec![
            VolumeRow {
                name: "b".into(),
                driver: "local".into(),
            },
            VolumeRow {
                name: "a".into(),
                driver: "local".into(),
            },
        ];
        sort_volumes(&mut rows);
        assert_eq!(rows[0].name, "a");
    }
}

#[cfg(test)]
mod log_unit_tests {
    use std::time::Duration;
    use crate::logs::{
        parse_docker_log_text, push_ring, should_flush, BatchQueue, LogSeq, LOG_BATCH_LINES,
        LOG_RING_MAX,
    };
    use crate::LogStream;

    #[test]
    fn splits_rfc3339_prefix() {
        let (ts, raw) = parse_docker_log_text("2024-01-02T03:04:05.000000000Z hello");
        assert!(ts.is_some());
        assert_eq!(raw, "hello");
    }

    #[test]
    fn unparsed_keeps_whole_line() {
        let (ts, raw) = parse_docker_log_text("not a timestamp");
        assert_eq!(ts, None);
        assert_eq!(raw, "not a timestamp");
    }

    #[test]
    fn flush_on_count_or_time() {
        assert!(should_flush(LOG_BATCH_LINES, Duration::from_millis(0)));
        assert!(should_flush(1, Duration::from_millis(16)));
        assert!(!should_flush(1, Duration::from_millis(15)));
    }

    #[test]
    fn seq_increments() {
        let mut seq = LogSeq::default();
        let a = seq.next_line(LogStream::Stdout, None, "a".into());
        let b = seq.next_line(LogStream::Stderr, None, "b".into());
        assert_eq!(a.seq, 1);
        assert_eq!(b.seq, 2);
        assert_eq!(b.stream, LogStream::Stderr);
    }

    #[test]
    fn ring_drops_oldest() {
        let mut lines = Vec::new();
        let mut seq = LogSeq::default();
        let extra = 10;
        let incoming: Vec<_> = (0..(LOG_RING_MAX + extra))
            .map(|_| seq.next_line(LogStream::Stdout, None, "x".into()))
            .collect();
        push_ring(&mut lines, incoming);
        assert_eq!(lines.len(), LOG_RING_MAX);
        assert_eq!(lines[0].seq, extra as u64 + 1);
    }

    #[test]
    fn batch_queue_omits_oldest_when_full() {
        let mut q = BatchQueue::new(2);
        assert_eq!(q.push_batch(vec![]), 0);
        let mut seq = LogSeq::default();
        let batch1: Vec<_> = (0..3)
            .map(|_| seq.next_line(LogStream::Stdout, None, "1".into()))
            .collect();
        let batch2: Vec<_> = (0..1)
            .map(|_| seq.next_line(LogStream::Stdout, None, "2".into()))
            .collect();
        let batch3: Vec<_> = (0..1)
            .map(|_| seq.next_line(LogStream::Stdout, None, "3".into()))
            .collect();
        q.push_batch(batch1);
        q.push_batch(batch2);
        let omitted = q.push_batch(batch3);
        assert_eq!(omitted, 3);
    }
}

#[cfg(test)]
mod event_tests {
    use std::task::Poll;

    use crate::events::{
        classify_events_poll, resource_from_docker_type, EventsSubscribe, InvalidateDebouncer,
    };
    use crate::ResourceKind;

    #[test]
    fn maps_docker_types() {
        assert_eq!(
            resource_from_docker_type("container"),
            Some(ResourceKind::Containers)
        );
        assert_eq!(resource_from_docker_type("image"), Some(ResourceKind::Images));
        assert_eq!(resource_from_docker_type("volume"), Some(ResourceKind::Volumes));
        assert_eq!(resource_from_docker_type("network"), None);
    }

    #[test]
    fn debounce_coalesces_same_kind() {
        let mut d = InvalidateDebouncer::new();
        d.note(ResourceKind::Containers, 0);
        d.note(ResourceKind::Containers, 50);
        assert!(d.take_ready(50).is_empty());
        let ready = d.take_ready(100);
        assert_eq!(ready, vec![ResourceKind::Containers]);
        assert!(d.take_ready(100).is_empty());
    }

    #[test]
    fn subscribe_poll_pending_or_ok_is_live() {
        assert_eq!(
            classify_events_poll::<(), ()>(&Poll::Pending),
            EventsSubscribe::Live
        );
        assert_eq!(
            classify_events_poll::<i32, ()>(&Poll::Ready(Some(Ok(1)))),
            EventsSubscribe::Live
        );
    }

    #[test]
    fn subscribe_poll_immediate_err_is_failed_retry() {
        assert_eq!(
            classify_events_poll::<(), &str>(&Poll::Ready(Some(Err("boom")))),
            EventsSubscribe::ImmediateError
        );
    }

    #[test]
    fn subscribe_poll_immediate_end() {
        assert_eq!(
            classify_events_poll::<(), ()>(&Poll::Ready(None)),
            EventsSubscribe::ImmediateEnd
        );
    }

    #[test]
    fn debounce_separates_kinds() {
        let mut d = InvalidateDebouncer::new();
        d.note(ResourceKind::Containers, 0);
        d.note(ResourceKind::Images, 0);
        let mut ready = d.take_ready(100);
        ready.sort_by_key(|k| k.as_str());
        assert_eq!(
            ready,
            vec![ResourceKind::Containers, ResourceKind::Images]
        );
    }
}
