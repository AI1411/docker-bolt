use std::collections::{HashMap, HashSet};

use crate::types::ResourceKind;

pub const INVALIDATE_DEBOUNCE_MS: u64 = 100;

pub fn resource_from_docker_type(ty: &str) -> Option<ResourceKind> {
    match ty {
        "container" => Some(ResourceKind::Containers),
        "image" => Some(ResourceKind::Images),
        "volume" => Some(ResourceKind::Volumes),
        _ => None,
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
