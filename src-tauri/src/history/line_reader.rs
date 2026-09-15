use std::io::{BufRead, Read};

use crate::terminal::AppError;

pub(super) const MAX_LINE_BYTES: u64 = 8 * 1024 * 1024;
pub(super) type Check<'a> = &'a dyn Fn() -> Result<(), AppError>;

pub(super) struct LineReader<R> {
    reader: R,
    buffer: Vec<u8>,
    pub skipped: usize,
}

impl<R: BufRead> LineReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            buffer: Vec::new(),
            skipped: 0,
        }
    }

    pub fn next(&mut self, check: Check<'_>) -> Result<Option<&[u8]>, AppError> {
        check()?;
        self.buffer.clear();
        let count = self
            .reader
            .by_ref()
            .take(MAX_LINE_BYTES + 1)
            .read_until(b'\n', &mut self.buffer)
            .map_err(io_error)?;
        if count == 0 {
            return Ok(None);
        }
        if count as u64 > MAX_LINE_BYTES {
            if self.buffer.last() != Some(&b'\n') {
                self.skip_remainder(check)?;
            }
            self.skipped += 1;
            self.buffer.clear();
        }
        Ok(Some(&self.buffer))
    }

    fn skip_remainder(&mut self, check: Check<'_>) -> Result<(), AppError> {
        loop {
            check()?;
            let available = self.reader.fill_buf().map_err(io_error)?;
            if available.is_empty() {
                return Ok(());
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let count = newline.map_or(available.len(), |index| index + 1);
            self.reader.consume(count);
            if newline.is_some() {
                return Ok(());
            }
        }
    }
}

fn io_error(error: std::io::Error) -> AppError {
    AppError::io(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::Cursor;

    #[test]
    fn reads_the_next_record_after_an_oversized_line_without_retaining_it() {
        let input = format!(
            "{}\nnext record\n",
            "x".repeat(MAX_LINE_BYTES as usize + 10)
        );
        let mut reader = LineReader::new(Cursor::new(input));
        assert_eq!(Some(&b""[..]), reader.next(&|| Ok(())).unwrap());
        assert_eq!(1, reader.skipped);
        assert_eq!(
            Some(&b"next record\n"[..]),
            reader.next(&|| Ok(())).unwrap()
        );
    }

    #[test]
    fn skipping_an_oversized_line_can_be_cancelled() {
        let input = vec![b'x'; MAX_LINE_BYTES as usize + 10];
        let mut reader = LineReader::new(Cursor::new(input));
        let calls = Cell::new(0);
        let check = || {
            calls.set(calls.get() + 1);
            if calls.get() > 1 {
                Err(AppError::io("cancelled"))
            } else {
                Ok(())
            }
        };
        assert!(reader.next(&check).is_err());
    }
}
