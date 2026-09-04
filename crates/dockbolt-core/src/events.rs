use std::collections::{HashMap, HashSet};
use std::task::Poll;

use crate::types::ResourceKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventsSubscribe {
    Live,
    ImmediateError,
    ImmediateEnd,
}

/// Classify a single poll of the Docker events stream.
/// `Pending` or first `Ok` means the subscribe succeeded; immediate `Err` is a failed retry.
pub fn classify_events_poll<T, E>(poll: &Poll<Option<Result<T, E>>>) -> EventsSubscribe {
    match poll {
        Poll::Pending | Poll::Ready(Some(Ok(_))) => EventsSubscribe::Live,
        Poll::Ready(Some(Err(_))) => EventsSubscribe::ImmediateError,
        Poll::Ready(None) => EventsSubscribe::ImmediateEnd,
    }
}

pub const INVALIDATE_DEBOUNCE_MS: u64 = 100;

pub fn resources_from_docker_type(ty: &str) -> Vec<ResourceKind> {
    match ty {
        "container" => vec![ResourceKind::Containers, ResourceKind::Compose],
        "image" => vec![ResourceKind::Images],
        "volume" => vec![ResourceKind::Volumes],
        "network" => vec![ResourceKind::Networks, ResourceKind::Compose],
        _ => vec![],
    }
}

pub struct InvalidateDebouncer {
    pending: HashSet<ResourceKind>,
    first_ms: HashMap<ResourceKind, u64>,
}

impl InvalidateDebouncer {
    pub fn new() -> Self {
        Self {
            pending: HashSet::new(),
            first_ms: HashMap::new(),
        }
    }

    pub fn note(&mut self, kind: ResourceKind, now_ms: u64) {
        self.pending.insert(kind);
        self.first_ms.entry(kind).or_insert(now_ms);
    }

    pub fn take_ready(&mut self, now_ms: u64) -> Vec<ResourceKind> {
        let mut ready = Vec::new();
        let kinds: Vec<_> = self.pending.iter().copied().collect();
        for kind in kinds {
            if let Some(first) = self.first_ms.get(&kind) {
                if now_ms.saturating_sub(*first) >= INVALIDATE_DEBOUNCE_MS {
                    ready.push(kind);
                    self.pending.remove(&kind);
                    self.first_ms.remove(&kind);
                }
            }
        }
        ready
    }
}

impl Default for InvalidateDebouncer {
    fn default() -> Self {
        Self::new()
    }
}
