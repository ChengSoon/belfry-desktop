use chardetng::EncodingDetector;
use encoding_rs::{CoderResult, Encoding, UTF_16BE, UTF_16LE};

/// Decode a bounded, read-only preview. Encoding failure alone is not evidence
/// that a file is binary; inspect decoded text after recognizing Unicode BOMs.
pub(super) fn decode(bytes: &[u8], truncated: bool) -> Option<String> {
    let content = if bytes.starts_with(&[0xff, 0xfe, 0, 0]) {
        decode_utf32(&bytes[4..], true, truncated)?
    } else if bytes.starts_with(&[0, 0, 0xfe, 0xff]) {
        decode_utf32(&bytes[4..], false, truncated)?
    } else if let Some((encoding, bom_len)) = Encoding::for_bom(bytes) {
        decode_encoding(&bytes[bom_len..], encoding, truncated)
    } else if let Some(encoding) = utf16_without_bom(bytes) {
        decode_encoding(bytes, encoding, truncated)
    } else {
        // Reject binary payloads before asking a charset detector to interpret
        // arbitrary bytes as a legacy single-byte encoding.
        if looks_binary(bytes) {
            return None;
        }
        // A preview can end inside a valid UTF-8 character. Do not reinterpret
        // the entire file as a legacy encoding because of that final fragment.
        match std::str::from_utf8(bytes) {
            Ok(text) => return Some(text.to_string()),
            Err(error) if truncated && error.error_len().is_none() => {
                return Some(
                    std::str::from_utf8(&bytes[..error.valid_up_to()])
                        .ok()?
                        .to_string(),
                );
            }
            Err(_) => {}
        }
        let mut detector = EncodingDetector::new();
        detector.feed(bytes, !truncated);
        decode_encoding(bytes, detector.guess(None, true), truncated)
    };
    (!looks_binary(content.as_bytes())).then_some(content)
}

fn decode_encoding(bytes: &[u8], encoding: &'static Encoding, truncated: bool) -> String {
    let mut decoder = encoding.new_decoder_without_bom_handling();
    // Every supported legacy encoding needs at most three UTF-8 bytes per
    // source byte. The input is capped at 512 KiB by the file reader.
    let mut content = String::with_capacity(bytes.len() * 3 + 4);
    let (result, read, _) = decoder.decode_to_string(bytes, &mut content, !truncated);
    debug_assert_eq!(result, CoderResult::InputEmpty);
    debug_assert_eq!(read, bytes.len());
    content
}

fn decode_utf32(bytes: &[u8], little_endian: bool, truncated: bool) -> Option<String> {
    if !truncated && bytes.len() % 4 != 0 {
        return None;
    }
    bytes
        .chunks_exact(4)
        .map(|unit| {
            let unit: [u8; 4] = unit.try_into().ok()?;
            char::from_u32(if little_endian {
                u32::from_le_bytes(unit)
            } else {
                u32::from_be_bytes(unit)
            })
        })
        .collect()
}

fn utf16_without_bom(bytes: &[u8]) -> Option<&'static Encoding> {
    let sample = &bytes[..bytes.len().min(8_192)];
    let pairs = sample.len() / 2;
    if pairs < 2 {
        return None;
    }
    let even_nuls = sample.chunks_exact(2).filter(|pair| pair[0] == 0).count();
    let odd_nuls = sample.chunks_exact(2).filter(|pair| pair[1] == 0).count();
    // UTF-16 code/config text has ASCII punctuation/spacing in one byte lane.
    // Require a strong asymmetry, then still validate the decoded content.
    if odd_nuls >= 2
        && odd_nuls * 100 >= pairs * 35
        && even_nuls * 10 <= pairs
        && odd_nuls > even_nuls * 4
    {
        Some(UTF_16LE)
    } else if even_nuls >= 2
        && even_nuls * 100 >= pairs * 35
        && odd_nuls * 10 <= pairs
        && even_nuls > odd_nuls * 4
    {
        Some(UTF_16BE)
    } else {
        None
    }
}

fn looks_binary(bytes: &[u8]) -> bool {
    if bytes.contains(&0) {
        return true;
    }
    let sample = &bytes[..bytes.len().min(8_192)];
    let controls = sample
        .iter()
        .filter(|byte| {
            **byte < 0x20 && !matches!(**byte, b'\n' | b'\r' | b'\t' | 0x08 | 0x0b | 0x0c | 0x1b)
        })
        .count();
    !sample.is_empty() && controls * 10 > sample.len()
}

#[cfg(test)]
#[path = "preview_text_test.rs"]
mod tests;
