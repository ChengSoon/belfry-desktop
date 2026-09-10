pub const MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    LineTooLong,
    InvalidUtf8,
    UnterminatedLine,
}

#[derive(Default)]
pub struct NdjsonFramer {
    buffer: Vec<u8>,
}

impl NdjsonFramer {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, FrameError> {
        self.buffer.extend_from_slice(chunk);
        let mut frames = Vec::new();
        while let Some(newline) = self.buffer.iter().position(|byte| *byte == b'\n') {
            if newline > MAX_LINE_BYTES
                || (newline == MAX_LINE_BYTES && self.buffer[newline - 1] == b'\r')
            {
                return Err(FrameError::LineTooLong);
            }
            let mut line: Vec<u8> = self.buffer.drain(..=newline).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let text = String::from_utf8(line).map_err(|_| FrameError::InvalidUtf8)?;
            frames.push(text);
        }
        if self.buffer.len() > MAX_LINE_BYTES {
            return Err(FrameError::LineTooLong);
        }
        Ok(frames)
    }

    pub fn finish(&self) -> Result<(), FrameError> {
        if self.buffer.is_empty() {
            Ok(())
        } else {
            Err(FrameError::UnterminatedLine)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_chunks_multiple_lines_and_crlf() {
        let mut framer = NdjsonFramer::default();
        assert!(framer.push(b"{\"a\":").unwrap().is_empty());
        assert_eq!(
            framer.push(b"1}\r\n{\"b\":2}\n").unwrap(),
            ["{\"a\":1}", "{\"b\":2}"]
        );
        assert_eq!(framer.finish(), Ok(()));
    }

    #[test]
    fn rejects_invalid_utf8_and_oversized_buffers() {
        let mut invalid = NdjsonFramer::default();
        assert_eq!(invalid.push(&[0xff, b'\n']), Err(FrameError::InvalidUtf8));
        let mut oversized = NdjsonFramer::default();
        assert_eq!(
            oversized.push(&vec![b'a'; MAX_LINE_BYTES + 1]),
            Err(FrameError::LineTooLong)
        );
    }

    #[test]
    fn rejects_an_unterminated_final_line() {
        let mut framer = NdjsonFramer::default();
        framer.push(b"{}").unwrap();
        assert_eq!(framer.finish(), Err(FrameError::UnterminatedLine));
    }
}
