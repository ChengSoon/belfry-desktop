use super::{cancel::Cancellation, snapshot::io_error};
use crate::terminal::AppError;
use std::io::{BufRead, Read};

pub(super) const MAX_LINE_BYTES: usize = 2 * 1024 * 1024;
const SKIP_CHUNK: usize = 32 * 1024;

#[derive(Default)]
pub(super) struct Cursor {
    pub offset: u64,
    pub line: u64,
    pub skipped: usize,
    buffer: Vec<u8>,
    discarding: bool,
}

impl Cursor {
    pub fn read(
        &mut self,
        input: &mut impl BufRead,
        budget: &mut u64,
        cancel: &Cancellation,
    ) -> Result<Option<Vec<u8>>, AppError> {
        cancel.check()?;
        let capacity = if self.discarding {
            SKIP_CHUNK
        } else {
            MAX_LINE_BYTES + 1 - self.buffer.len()
        };
        let mut part = Vec::new();
        let count = input
            .by_ref()
            .take((*budget).min(capacity as u64))
            .read_until(b'\n', &mut part)
            .map_err(io_error)?;
        self.offset += count as u64;
        *budget -= count as u64;
        let complete = part.last() == Some(&b'\n') || count == 0;
        if !self.discarding {
            self.buffer.extend_from_slice(&part);
        }
        if self.buffer.len() > MAX_LINE_BYTES {
            self.discarding = true;
            self.buffer.clear();
            self.skipped += 1;
        }
        if !complete {
            return Ok(None);
        }
        self.line += 1;
        if self.discarding {
            self.discarding = false;
            return Ok(Some(Vec::new()));
        }
        Ok(Some(std::mem::take(&mut self.buffer)))
    }

    pub fn finish(&mut self) -> Vec<u8> {
        self.line += 1;
        self.discarding = false;
        std::mem::take(&mut self.buffer)
    }
}
