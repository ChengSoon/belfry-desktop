use super::{
    cancel::Check,
    contracts::ScanDiagnostics,
    records::{Record, relevant},
};
use crate::{agent::AgentKind, usage::codex::CodexRecord};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    sync::Arc,
};

pub(super) const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const CHUNK_BYTES: usize = 64 * 1024;
pub(super) const MAX_FILE_INDEX_BYTES: usize = 16 * 1024 * 1024;
const META_LINES: usize = 8;
const ARC_OVERHEAD: usize = 2 * size_of::<usize>();

pub(super) enum ReadError {
    Io,
    Capacity,
    Stopped(String),
}

impl From<std::io::Error> for ReadError {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}

pub(super) enum ReadTarget<'a> {
    Index(usize),
    Session,
    Stream(&'a mut dyn FnMut(&Record) -> Result<(), String>),
}

pub(super) struct ReadContext<'a> {
    pub agent: AgentKind,
    pub check: Check<'a>,
    pub metrics: &'a mut ScanDiagnostics,
    pub target: ReadTarget<'a>,
}

#[derive(Clone, Default)]
pub(super) struct ParsedLog {
    records: Vec<Arc<Record>>,
    tail: Option<Arc<Record>>,
    buffer: Vec<u8>,
    discarding: bool,
    lines: usize,
    skipped: u64,
    tail_skipped: bool,
    record_bytes: usize,
    session_id: Option<String>,
    found_meta: bool,
    pub offset: u64,
}

impl ParsedLog {
    pub fn read(
        &mut self,
        file: &mut File,
        len: u64,
        context: &mut ReadContext<'_>,
    ) -> Result<(), ReadError> {
        self.check_budget(&context.target)?;
        file.seek(SeekFrom::Start(self.offset))?;
        self.tail = None;
        self.tail_skipped = false;
        let mut buffer = [0; CHUNK_BYTES];
        while self.offset < len {
            (context.check)().map_err(ReadError::Stopped)?;
            let wanted = (len - self.offset).min(CHUNK_BYTES as u64) as usize;
            let count = file.read(&mut buffer[..wanted])?;
            if count == 0 {
                return Err(ReadError::Io);
            }
            self.offset += count as u64;
            context.metrics.read_bytes += count as u64;
            self.feed(&buffer[..count], context)?;
            if self.header_done(&context.target) {
                return Ok(());
            }
        }
        if !self.discarding {
            let bytes = std::mem::take(&mut self.buffer);
            let (tail, skipped) = self.parse(&bytes, context, true);
            if let Some(record) = tail {
                self.accept(record, true, context)?;
            }
            self.tail_skipped = skipped;
            self.buffer = bytes;
        }
        self.check_budget(&context.target)
    }

    pub fn records(&self) -> impl Iterator<Item = &Record> {
        self.records.iter().chain(self.tail.iter()).map(Arc::as_ref)
    }

    pub fn session_id(&self) -> Option<&str> {
        if !self.found_meta && self.lines < META_LINES {
            if let Some(Record::Codex(CodexRecord::Meta { id, .. })) = self.tail.as_deref() {
                return id.as_deref();
            }
        }
        self.session_id.as_deref()
    }

    pub fn skipped_lines(&self) -> u64 {
        self.skipped + u64::from(self.tail_skipped)
    }

    pub fn bytes(&self) -> usize {
        self.record_bytes
            + self.buffer.capacity()
            + self.records.capacity() * size_of::<Arc<Record>>()
            + self.tail.as_deref().map_or(0, record_bytes)
            + self.session_id.as_ref().map_or(0, String::capacity)
            + size_of::<Self>()
    }

    fn feed(&mut self, bytes: &[u8], context: &mut ReadContext<'_>) -> Result<(), ReadError> {
        // str 的换行搜索使用标准库快速路径；跨块 UTF-8 / 坏字节仍按原字节推进。
        if let Ok(text) = std::str::from_utf8(bytes) {
            for part in text.split_inclusive('\n') {
                self.feed_part(part.as_bytes(), context)?;
                if self.header_done(&context.target) {
                    break;
                }
            }
        } else {
            for part in bytes.split_inclusive(|byte| *byte == b'\n') {
                self.feed_part(part, context)?;
                if self.header_done(&context.target) {
                    break;
                }
            }
        }
        Ok(())
    }

    fn feed_part(&mut self, part: &[u8], context: &mut ReadContext<'_>) -> Result<(), ReadError> {
        (context.check)().map_err(ReadError::Stopped)?;
        if !self.discarding {
            self.buffer_part(part);
        }
        if part.last() == Some(&b'\n') {
            self.finish_line(context)?;
        }
        Ok(())
    }

    fn buffer_part(&mut self, part: &[u8]) {
        if self.buffer.len() + part.len() > MAX_LINE_BYTES {
            self.buffer = Vec::new();
            self.discarding = true;
            self.skipped += 1;
        } else {
            self.buffer.extend_from_slice(part);
        }
    }

    fn finish_line(&mut self, context: &mut ReadContext<'_>) -> Result<(), ReadError> {
        let mut bytes = std::mem::take(&mut self.buffer);
        if !self.discarding {
            let (record, skipped) = self.parse(&bytes, context, false);
            self.skipped += u64::from(skipped);
            if let Some(record) = record {
                self.accept(record, false, context)?;
            }
        }
        self.lines += 1;
        self.discarding = false;
        bytes.clear();
        if bytes.capacity() <= CHUNK_BYTES {
            self.buffer = bytes;
        }
        self.check_budget(&context.target)
    }

    fn parse(
        &self,
        bytes: &[u8],
        context: &mut ReadContext<'_>,
        tail: bool,
    ) -> (Option<Record>, bool) {
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return (None, false);
        }
        let matches = relevant(context.agent, bytes);
        let metadata =
            context.agent == AgentKind::Codex && !self.found_meta && self.lines < META_LINES;
        if !matches && !metadata && !tail {
            return (None, false);
        }
        context.metrics.parsed_lines += 1;
        match Record::parse(context.agent, bytes) {
            Ok(record) => (filtered(record, matches, metadata), false),
            Err(()) => (None, true),
        }
    }

    fn accept(
        &mut self,
        record: Record,
        tail: bool,
        context: &mut ReadContext<'_>,
    ) -> Result<(), ReadError> {
        if !tail && !self.found_meta && self.lines < META_LINES {
            if let Record::Codex(CodexRecord::Meta { id, .. }) = &record {
                self.session_id.clone_from(id);
                self.found_meta = true;
            }
        }
        match &mut context.target {
            ReadTarget::Index(_) if !tail => {
                self.record_bytes += record_bytes(&record);
                self.records.push(Arc::new(record));
            }
            ReadTarget::Index(_) | ReadTarget::Session if tail => {
                self.tail = Some(Arc::new(record));
            }
            ReadTarget::Stream(consume) => consume(&record).map_err(ReadError::Stopped)?,
            _ => {}
        }
        Ok(())
    }

    fn header_done(&self, target: &ReadTarget<'_>) -> bool {
        matches!(target, ReadTarget::Session) && (self.found_meta || self.lines >= META_LINES)
    }

    fn check_budget(&self, target: &ReadTarget<'_>) -> Result<(), ReadError> {
        if let ReadTarget::Index(budget) = target {
            if self.bytes() > *budget {
                return Err(ReadError::Capacity);
            }
        }
        Ok(())
    }
}

fn record_bytes(record: &Record) -> usize {
    size_of::<Record>() + ARC_OVERHEAD + record.heap_bytes()
}

fn filtered(record: Option<Record>, matches: bool, metadata: bool) -> Option<Record> {
    if matches {
        return record;
    }
    match record {
        Some(Record::Codex(CodexRecord::Meta { id, .. })) if metadata => {
            Some(Record::Codex(CodexRecord::Meta { id, cwd: None }))
        }
        _ => None,
    }
}
