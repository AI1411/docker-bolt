use std::collections::VecDeque;
use std::time::Duration;

use chrono::DateTime;

use crate::types::{LogLine, LogStream};

pub const LOG_TAIL: &str = "1000";
pub const LOG_BATCH_LINES: usize = 200;
pub const LOG_BATCH_WINDOW: Duration = Duration::from_millis(16);
pub const LOG_CHANNEL_CAPACITY: usize = 1024;
pub const LOG_RING_MAX: usize = 20_000;

pub fn parse_docker_log_text(text: &str) -> (Option<i64>, String) {
    let Some((prefix, rest)) = text.split_once(' ') else {
        return (None, text.to_string());
    };
    match DateTime::parse_from_rfc3339(prefix) {
        Ok(dt) => (Some(dt.timestamp_millis()), rest.to_string()),
        Err(_) => (None, text.to_string()),
    }
}

pub fn should_flush(buffered_lines: usize, elapsed: Duration) -> bool {
    buffered_lines >= LOG_BATCH_LINES || elapsed >= LOG_BATCH_WINDOW
}

#[derive(Default)]
pub struct LogSeq {
    next: u64,
}

impl LogSeq {
    pub fn next_line(
        &mut self,
        stream: LogStream,
        timestamp_unix_ms: Option<i64>,
        raw: String,
    ) -> LogLine {
        self.next += 1;
        LogLine {
            seq: self.next,
            stream,
            timestamp_unix_ms,
            raw,
        }
    }
}

pub fn push_ring(lines: &mut Vec<LogLine>, incoming: Vec<LogLine>) {
    lines.extend(incoming);
    if lines.len() > LOG_RING_MAX {
        let overflow = lines.len() - LOG_RING_MAX;
        lines.drain(0..overflow);
    }
}

pub struct BatchQueue {
    cap: usize,
    q: VecDeque<Vec<LogLine>>,
}

impl BatchQueue {
    pub fn new(cap: usize) -> Self {
        Self {
            cap,
            q: VecDeque::new(),
        }
    }

    pub fn push_batch(&mut self, lines: Vec<LogLine>) -> u64 {
        if self.cap == 0 {
            return lines.len() as u64;
        }
        let mut omitted = 0u64;
        while self.q.len() >= self.cap {
            omitted += self.q.pop_front().map(|b| b.len() as u64).unwrap_or(0);
        }
        self.q.push_back(lines);
        omitted
    }

    pub fn pop_batch(&mut self) -> Option<Vec<LogLine>> {
        self.q.pop_front()
    }
}
