use super::{
    cancel::Cancellation,
    contracts::{DetailPage, HistoryEntry},
    cursor::Cursor,
    dedup::Parser,
    snapshot::{Snapshot, io_error},
    sources,
};
use crate::terminal::AppError;
use serde_json::Value;
use std::{
    io::{BufReader, Read, Seek, SeekFrom},
    path::Path,
};

pub(super) const PAGE_ENTRIES: usize = 60;
const PAGE_READ_BYTES: u64 = 4 * 1024 * 1024;
const PAGE_TEXT_BYTES: usize = 512 * 1024;

pub(super) struct DetailReader {
    id: String,
    files: Vec<Snapshot>,
    file_index: usize,
    cursor: Cursor,
    parser: Parser,
    cancel: Cancellation,
    note: Option<String>,
    scanned: u64,
    skipped: usize,
    pending: Option<HistoryEntry>,
    next_page: u32,
    last_page: Option<DetailPage>,
}

impl DetailReader {
    pub fn open(
        request: super::contracts::DetailRequest,
        root: &Path,
        cancel: Cancellation,
    ) -> Result<Self, AppError> {
        let sources = sources::discover(root, &request.session, &cancel)?;
        Ok(Self {
            id: request.reader_id,
            files: sources.files,
            file_index: 0,
            cursor: Cursor::default(),
            parser: Parser::new(request.session),
            cancel,
            note: sources.note,
            scanned: 0,
            skipped: 0,
            pending: None,
            next_page: 0,
            last_page: None,
        })
    }

    pub fn page(&mut self, requested: u32) -> Result<DetailPage, AppError> {
        self.cancel.check()?;
        for file in &self.files {
            file.open()?;
        }
        if let Some(cached) = self
            .last_page
            .as_ref()
            .filter(|page| page.page == requested)
        {
            return Ok(cached.clone());
        }
        if requested != self.next_page {
            return Err(AppError::invalid_argument("分页顺序已变化，请刷新详情"));
        }
        let mut page = DetailPage {
            reader_id: self.id.clone(),
            page: requested,
            total_bytes: self.files.iter().map(Snapshot::len).sum(),
            note: self.note.clone(),
            ..Default::default()
        };
        let mut budget = PAGE_READ_BYTES;
        if let Some(entry) = self.pending.take() {
            page.entries.push(entry);
        }
        while self.file_index < self.files.len() && budget > 0 && page.entries.len() < PAGE_ENTRIES
        {
            if self.read_file(&mut page, &mut budget)? {
                break;
            }
        }
        page.has_more = self.file_index < self.files.len() || self.pending.is_some();
        page.scanned_bytes = self.scanned;
        page.skipped_lines = self.skipped + self.cursor.skipped;
        self.next_page += 1;
        self.last_page = Some(page.clone());
        Ok(page)
    }

    fn read_file(&mut self, page: &mut DetailPage, budget: &mut u64) -> Result<bool, AppError> {
        let snapshot = self.files[self.file_index].clone();
        let mut file = snapshot.open()?;
        file.seek(SeekFrom::Start(self.cursor.offset))
            .map_err(io_error)?;
        let mut input = BufReader::new(file.take(snapshot.len() - self.cursor.offset));
        let mut full = false;
        while self.cursor.offset < snapshot.len() && *budget > 0 && !full {
            let before = *budget;
            let record = self.cursor.read(&mut input, budget, &self.cancel)?;
            if before == *budget {
                return Err(AppError::io("日志读取提前结束，请刷新详情后重试"));
            }
            self.scanned += before - *budget;
            if let Some(bytes) = record {
                full = self.append(&bytes, page);
            }
            full |= page.entries.len() >= PAGE_ENTRIES;
        }
        snapshot.open()?;
        if self.cursor.offset == snapshot.len() {
            let tail = self.cursor.finish();
            full |= self.append(&tail, page);
            self.skipped += self.cursor.skipped;
            self.cursor = Cursor::default();
            self.file_index += 1;
            self.parser.next_file();
        }
        Ok(full)
    }

    fn append(&mut self, bytes: &[u8], page: &mut DetailPage) -> bool {
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return false;
        }
        let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
            self.skipped += 1;
            return false;
        };
        let source = format!("{}:{}", self.file_index, self.cursor.line);
        let Some(entry) = self.parser.parse(&value, &source) else {
            return false;
        };
        let size = serde_json::to_vec(&page.entries).map_or(PAGE_TEXT_BYTES, |data| data.len());
        let next = serde_json::to_vec(&entry).map_or(PAGE_TEXT_BYTES, |data| data.len());
        if !page.entries.is_empty() && size + next > PAGE_TEXT_BYTES {
            self.pending = Some(entry);
            return true;
        }
        page.entries.push(entry);
        false
    }
}
