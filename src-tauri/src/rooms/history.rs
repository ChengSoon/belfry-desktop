//! 从独占字节游标向前分页。每页固定内存，不依赖总事件数量；游标固定首屏时的已提交末尾。
use super::ledger::{self, LedgerEvent};
use crate::terminal::AppError;
use serde::Serialize;
use std::{fs::File, io::{Read, Seek, SeekFrom}, path::Path};

const BLOCK_BYTES: usize = 8 * 1024;
const MAX_RECORD_BYTES: usize = 64 * 1024;
const MAX_PAGE_BYTES: usize = 512 * 1024;
const MAX_PAGE_ENTRIES: usize = 200;

#[cfg(test)]
thread_local! { static READ_BYTES: std::cell::Cell<u64> = const { std::cell::Cell::new(0) }; }
#[cfg(test)]
pub(super) fn take_read_bytes() -> u64 { READ_BYTES.replace(0) }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    /// 页内按时间线顺序；下一页是更早的一页。
    pub entries: Vec<HistoryRecord>,
    pub next_cursor: Option<String>,
    pub ledger_bytes: u64,
    pub snapshot_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecord {
    /// 十进制字节偏移，避免 JS number 对大文件整数截断。
    pub offset: String,
    pub bytes: u64,
    /// 包括未知 kind / v，调用方可以展示为未知事件。
    pub event: Option<LedgerEvent>,
    /// 非法信封或超大行的原文预览；超大行只给尾部 64 KiB，磁盘内容不改。
    pub raw: Option<String>,
    pub truncated: bool,
}

pub fn read_page(path: &Path, committed: u64, cursor: Option<&str>, limit: Option<usize>) -> Result<HistoryPage, AppError> {
    let limit = limit.unwrap_or(50);
    if !(1..=MAX_PAGE_ENTRIES).contains(&limit) {
        return Err(AppError::invalid_argument("History page size must be between 1 and 200."));
    }
    let (end, before) = parse_cursor(cursor, committed)?;
    if ledger::length(path)? < committed { return Err(AppError::io("Ledger is shorter than its committed length.")); }
    if before == 0 {
        return Ok(HistoryPage { entries: Vec::new(), next_cursor: None, ledger_bytes: committed, snapshot_bytes: end });
    }
    let mut file = File::open(path).map_err(io_error)?;
    if before != end {
        file.seek(SeekFrom::Start(before - 1)).map_err(io_error)?;
        let mut byte = [0];
        file.read_exact(&mut byte).map_err(io_error)?;
        if byte[0] != b'\n' { return Err(AppError::invalid_argument("History cursor must point to a record boundary.")); }
    }
    let mut reader = ReverseLines::new(file, before);
    let mut entries = Vec::new();
    let mut next = before;
    let mut used_bytes = 0;
    while entries.len() < limit {
        let Some(line) = reader.next_line()? else { next = 0; break; };
        if !line.truncated && line.data.iter().all(u8::is_ascii_whitespace) { next = line.start; continue; }
        if !entries.is_empty() && used_bytes + line.data.len() > MAX_PAGE_BYTES { break; }
        next = line.start;
        used_bytes += line.data.len();
        let event = if line.truncated { None } else { serde_json::from_slice(&line.data).ok() };
        let raw = event.is_none().then(|| String::from_utf8_lossy(&line.data).into_owned());
        entries.push(HistoryRecord { offset: line.start.to_string(), bytes: line.bytes, event, raw, truncated: line.truncated });
    }
    entries.reverse();
    Ok(HistoryPage { entries, next_cursor: (next > 0).then(|| format!("v1:{end}:{next}")), ledger_bytes: committed, snapshot_bytes: end })
}

fn parse_cursor(cursor: Option<&str>, committed: u64) -> Result<(u64, u64), AppError> {
    let Some(cursor) = cursor else { return Ok((committed, committed)); };
    let bad = || AppError::invalid_argument("Invalid or expired history cursor.");
    if cursor.len() > 64 { return Err(bad()); }
    let mut fields = cursor.split(':');
    if fields.next() != Some("v1") { return Err(bad()); }
    let end = fields.next().and_then(|value| value.parse::<u64>().ok()).ok_or_else(bad)?;
    let before = fields.next().and_then(|value| value.parse::<u64>().ok()).ok_or_else(bad)?;
    if fields.next().is_some() || before > end || end > committed { return Err(bad()); }
    Ok((end, before))
}

fn io_error(error: std::io::Error) -> AppError { AppError::io(format!("Cannot read room history: {error}")) }

struct Line { start: u64, bytes: u64, data: Vec<u8>, truncated: bool }
struct ReverseLines { file: File, position: u64, end: u64, block: Vec<u8>, index: usize }
impl ReverseLines {
    fn new(file: File, before: u64) -> Self { Self { file, position: before, end: before, block: Vec::new(), index: 0 } }

    fn next_byte(&mut self) -> Result<Option<(u64, u8)>, AppError> {
        if self.index == 0 {
            if self.position == 0 { return Ok(None); }
            let count = self.position.min(BLOCK_BYTES as u64) as usize;
            self.position -= count as u64;
            self.block.resize(count, 0);
            self.file.seek(SeekFrom::Start(self.position)).map_err(io_error)?;
            self.file.read_exact(&mut self.block).map_err(io_error)?;
            self.index = count;
            #[cfg(test)]
            READ_BYTES.set(READ_BYTES.get() + count as u64);
        }
        self.index -= 1;
        Ok(Some((self.position + self.index as u64, self.block[self.index])))
    }

    fn next_line(&mut self) -> Result<Option<Line>, AppError> {
        if self.end == 0 { return Ok(None); }
        let end = self.end;
        let mut data = Vec::new();
        let mut size = 0usize;
        let start = loop {
            let Some((offset, byte)) = self.next_byte()? else { break 0; };
            if byte == b'\n' {
                if offset + 1 == end { continue; }
                break offset + 1;
            }
            size = size.saturating_add(1);
            if data.len() < MAX_RECORD_BYTES { data.push(byte); }
        };
        data.reverse();
        self.end = start;
        Ok(Some(Line { start, bytes: end - start, data, truncated: size > MAX_RECORD_BYTES }))
    }
}
