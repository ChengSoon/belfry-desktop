use super::{
    aggregate::Accumulator,
    stamp::{Stamp, io_error},
};
use crate::{
    agent::{AgentKind, AgentSessionRef},
    terminal::AppError,
};
use serde_json::Value;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
};

const MAX_LINE_BYTES: usize = 2 * 1024 * 1024;

pub(super) struct Cursor {
    path: PathBuf,
    session: AgentSessionRef,
    stamp: Option<Stamp>,
    verified: bool,
    buffer: Vec<u8>,
    discarding: bool,
    complete_tail: bool,
    pub offset: u64,
    pub skipped: usize,
}

impl Cursor {
    pub fn new(path: PathBuf, session: AgentSessionRef) -> Self {
        let verified = session.agent == AgentKind::Claude
            && path.file_stem().and_then(|value| value.to_str()) == Some(&session.id);
        Self {
            path,
            session,
            stamp: None,
            verified,
            buffer: Vec::new(),
            discarding: false,
            complete_tail: false,
            offset: 0,
            skipped: 0,
        }
    }

    pub fn changed(&self) -> bool {
        self.stamp.as_ref().is_some_and(|previous| {
            Stamp::read(&self.path).map_or(true, |current| current.changed_from(previous))
        })
    }

    pub fn advance(&mut self, budget: u64, accumulator: &mut Accumulator) -> Result<u64, AppError> {
        let stamp = Stamp::read(&self.path)?;
        let mut file = File::open(&self.path).map_err(io_error)?;
        file.seek(SeekFrom::Start(self.offset)).map_err(io_error)?;
        let mut bytes = Vec::new();
        file.take(budget)
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
        self.offset += bytes.len() as u64;
        self.stamp = Some(stamp);
        if !bytes.is_empty() {
            self.feed(&bytes, accumulator);
            self.final_tail(accumulator);
        }
        Ok(bytes.len() as u64)
    }

    pub fn pending(&self) -> bool {
        self.stamp
            .as_ref()
            .is_some_and(|stamp| self.offset < stamp.len)
            || (!self.buffer.is_empty() && !self.complete_tail)
            || self.discarding
    }

    fn feed(&mut self, bytes: &[u8], accumulator: &mut Accumulator) {
        self.complete_tail = false;
        for part in bytes.split_inclusive(|byte| *byte == b'\n') {
            if !self.discarding {
                self.buffer_part(part);
            }
            if part.last() == Some(&b'\n') {
                self.finish_line(accumulator);
                self.discarding = false;
            }
        }
    }

    fn buffer_part(&mut self, part: &[u8]) {
        if self.buffer.len() + part.len() > MAX_LINE_BYTES {
            self.buffer.clear();
            self.discarding = true;
            self.skipped += 1;
        } else {
            self.buffer.extend_from_slice(part);
        }
    }

    fn finish_line(&mut self, accumulator: &mut Accumulator) {
        if self.discarding || self.buffer.iter().all(u8::is_ascii_whitespace) {
            self.buffer.clear();
            return;
        }
        match serde_json::from_slice::<Value>(&self.buffer) {
            Ok(value) => self.record(value, accumulator),
            Err(_) => self.skipped += 1,
        }
        self.buffer.clear();
    }

    fn final_tail(&mut self, accumulator: &mut Accumulator) {
        if self.buffer.is_empty()
            || self.discarding
            || self
                .stamp
                .as_ref()
                .is_some_and(|stamp| self.offset < stamp.len)
        {
            return;
        }
        if let Ok(value) = serde_json::from_slice::<Value>(&self.buffer) {
            self.record(value, accumulator);
            self.complete_tail = true;
        }
    }

    fn record(&mut self, value: Value, accumulator: &mut Accumulator) {
        if self.session.agent == AgentKind::Codex && value["type"] == "session_meta" {
            self.verified = value["payload"]["session_id"]
                .as_str()
                .or_else(|| value["payload"]["id"].as_str())
                == Some(&self.session.id);
        }
        if self.verified {
            accumulator.consume(&value);
        }
    }
}
