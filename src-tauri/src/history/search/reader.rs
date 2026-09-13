use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use crate::agent::AgentKind;
use crate::history::line_reader::LineReader;
use crate::terminal::AppError;

use super::{query, text, SearchCancellation};

const MAX_FILE_TEXT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub(super) struct TextScan {
    pub texts: Option<Vec<String>>,
    pub snippet: Option<String>,
    pub skipped_lines: usize,
    pub text_bytes: usize,
}

pub(super) struct ScanRequest<'a> {
    pub path: &'a Path,
    pub agent: AgentKind,
    pub needle: &'a str,
    pub cancel: &'a SearchCancellation,
}

pub(super) fn scan(request: ScanRequest<'_>) -> Result<TextScan, AppError> {
    let file = File::open(request.path).map_err(|error| AppError::io(error.to_string()))?;
    let mut reader = LineReader::new(BufReader::new(file));
    let mut scan = TextScan {
        texts: Some(Vec::new()),
        ..Default::default()
    };
    while let Some(line) = reader.next(&|| request.cancel.check())? {
        append_line(line, &request, &mut scan);
    }
    scan.skipped_lines += reader.skipped;
    Ok(scan)
}

fn append_line(buffer: &[u8], request: &ScanRequest<'_>, scan: &mut TextScan) {
    if buffer.iter().all(u8::is_ascii_whitespace) {
        return;
    }
    let Ok(record) = serde_json::from_slice(buffer) else {
        scan.skipped_lines += 1;
        return;
    };
    for text in text::record_text(request.agent, &record) {
        if scan.snippet.is_none() {
            scan.snippet = query::excerpt(&text, request.needle);
        }
        scan.text_bytes += text.len();
        if scan.text_bytes > MAX_FILE_TEXT_BYTES {
            scan.texts = None;
        }
        if let Some(texts) = &mut scan.texts {
            texts.push(text);
        }
    }
}
