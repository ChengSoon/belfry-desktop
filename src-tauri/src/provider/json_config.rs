//! Small lossless JSON/JSONC editor: untouched keys, comments and whitespace stay byte-for-byte.
use crate::terminal::AppError;
use serde_json::{Value, json};

fn invalid() -> AppError {
    AppError::invalid_argument("CLI 配置不是有效 JSON/JSONC，已保留原文件")
}

pub(crate) fn parse(text: &str) -> Result<Value, AppError> {
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    let value: Value = serde_json::from_slice(&clean(text)?).map_err(|_| invalid())?;
    if !value.is_object() {
        return Err(invalid());
    }
    Ok(value)
}

fn clean(text: &str) -> Result<Vec<u8>, AppError> {
    let mut bytes = without_comments(text)?;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i = string_end(&bytes, i)?;
            continue;
        }
        if bytes[i] == b',' {
            let j = space(&bytes, i + 1);
            if matches!(bytes.get(j), Some(b'}' | b']')) {
                bytes[i] = b' ';
            }
        }
        i += 1;
    }
    Ok(bytes)
}
fn without_comments(text: &str) -> Result<Vec<u8>, AppError> {
    let mut bytes = text.as_bytes().to_vec();
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        bytes[..3].fill(b' ');
    }
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i = string_end(&bytes, i)?;
            continue;
        }
        if bytes.get(i..i + 2) == Some(b"//") {
            while i < bytes.len() && bytes[i] != b'\n' {
                bytes[i] = b' ';
                i += 1;
            }
        } else if bytes.get(i..i + 2) == Some(b"/*") {
            bytes[i..i + 2].fill(b' ');
            i += 2;
            while i + 1 < bytes.len() && &bytes[i..i + 2] != b"*/" {
                if bytes[i] != b'\n' && bytes[i] != b'\r' {
                    bytes[i] = b' ';
                }
                i += 1;
            }
            if i + 1 >= bytes.len() {
                return Err(invalid());
            }
            bytes[i..i + 2].fill(b' ');
            i += 2;
        } else {
            i += 1;
        }
    }
    Ok(bytes)
}
fn space(bytes: &[u8], mut i: usize) -> usize {
    while bytes.get(i).is_some_and(u8::is_ascii_whitespace) {
        i += 1;
    }
    i
}
fn string_end(bytes: &[u8], start: usize) -> Result<usize, AppError> {
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return Ok(i + 1),
            _ => i += 1,
        }
    }
    Err(invalid())
}
fn value_end(bytes: &[u8], start: usize) -> Result<usize, AppError> {
    if bytes.get(start) == Some(&b'"') {
        return string_end(bytes, start);
    }
    let mut depth = 0;
    let mut i = start;
    while i < bytes.len() {
        match bytes[i] {
            b'"' => {
                i = string_end(bytes, i)?;
                continue;
            }
            b'{' | b'[' => depth += 1,
            b'}' | b']' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    return Ok(i + 1);
                }
            }
            b',' | b'}' | b']' if depth == 0 => break,
            _ => {}
        }
        i += 1;
    }
    while i > start && bytes[i - 1].is_ascii_whitespace() {
        i -= 1;
    }
    Ok(i)
}
struct Member {
    key: String,
    start: usize,
    value: usize,
    end: usize,
    comma: Option<usize>,
}
fn members(bytes: &[u8], start: usize) -> Result<(Vec<Member>, usize), AppError> {
    if bytes.get(start) != Some(&b'{') {
        return Err(invalid());
    }
    let mut all = Vec::new();
    let mut i = space(bytes, start + 1);
    while bytes.get(i) != Some(&b'}') {
        if bytes.get(i) != Some(&b'"') {
            return Err(invalid());
        }
        let key_end = string_end(bytes, i)?;
        let key = serde_json::from_slice(&bytes[i..key_end]).map_err(|_| invalid())?;
        let colon = space(bytes, key_end);
        if bytes.get(colon) != Some(&b':') {
            return Err(invalid());
        }
        let value = space(bytes, colon + 1);
        let end = value_end(bytes, value)?;
        let next = space(bytes, end);
        let comma = (bytes.get(next) == Some(&b',')).then_some(next);
        all.push(Member {
            key,
            start: i,
            value,
            end,
            comma,
        });
        i = space(bytes, comma.map_or(next, |v| v + 1));
        if comma.is_none() && bytes.get(i) != Some(&b'}') {
            return Err(invalid());
        }
    }
    Ok((all, i))
}

pub(crate) fn set(text: &str, path: &[&str], value: Option<&Value>) -> Result<String, AppError> {
    let text = if text.trim().is_empty() { "{}\n" } else { text };
    let before = parse(text)?;
    let current = path.iter().try_fold(&before, |value, key| value.get(*key));
    if value == current {
        return Ok(text.into());
    }
    let bytes = clean(text)?;
    let commented = without_comments(text)?;
    let mut start = space(&bytes, 0);
    for (depth, key) in path.iter().enumerate() {
        let (items, close) = members(&bytes, start)?;
        if let Some((index, item)) = items.iter().enumerate().find(|(_, m)| m.key == *key) {
            if depth + 1 < path.len() {
                start = item.value;
                continue;
            }
            let mut out = text.to_string();
            if let Some(value) = value {
                out.replace_range(item.value..item.end, &value.to_string());
            } else {
                // A trailing JSONC comma was blanked in `clean`; include it when removing the last item.
                let after = space(&commented, item.end);
                let trailing = (commented.get(after) == Some(&b',')).then_some(after);
                // Remove value/key and comma separately to keep intervening comments.
                if let Some(comma) = item.comma.or(trailing) {
                    out.replace_range(comma..comma + 1, "");
                }
                out.replace_range(item.start..item.end, "");
                if item.comma.is_none() && index > 0 {
                    if let Some(comma) = items[index - 1].comma {
                        out.replace_range(comma..comma + 1, "");
                    }
                }
            }
            parse(&out)?;
            return Ok(out);
        }
        let Some(value) = value else {
            return Ok(text.into());
        };
        let mut nested = value.clone();
        for key in path[depth + 1..].iter().rev() {
            nested = json!({*key: nested});
        }
        let mut out = text.to_string();
        // Insert before the closing brace, after any existing trailing comma/comments.
        let comma = if let Some(last) = items.last() {
            if commented.get(space(&commented, last.end)) == Some(&b',') {
                ""
            } else {
                ","
            }
        } else {
            ""
        };
        out.insert_str(
            close,
            &format!(
                "{comma}\n  {}: {nested}\n",
                serde_json::to_string(key).unwrap()
            ),
        );
        parse(&out)?;
        return Ok(out);
    }
    Err(invalid())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn null_removal_and_commented_trailing_commas_preserve_unowned_comments() {
        let original = "{\"remove\":null /* keep this, comment */,\n}";
        let added = set(original, &["added"], Some(&json!(null))).unwrap();
        assert!(parse(&added).unwrap().get("added").is_some());
        let removed = set(&added, &["remove"], None).unwrap();
        assert!(removed.contains("/* keep this, comment */"));
        assert!(parse(&removed).unwrap().get("remove").is_none());
        assert_eq!(parse(&removed).unwrap(), json!({"added":null}));
        assert_eq!(
            parse(&set(original, &["remove"], None).unwrap()).unwrap(),
            json!({})
        );
    }
    #[test]
    fn preserves_comments_and_unowned_keys_while_editing_and_removing() {
        let original = "{\n // 用户的 MCP\n \"mcp\": {\"url\":\"https://host/a//b\"},\n \"providers\": { /* 保留 */ \"mine\": {}, },\n}";
        let added = set(
            original,
            &["providers", "belfry"],
            Some(&json!({"apiKey":"key"})),
        )
        .unwrap();
        assert!(added.contains("/* 保留 */ \"mine\": {}"));
        let changed = set(&added, &["model"], Some(&json!("belfry/model"))).unwrap();
        let removed = set(&changed, &["providers", "belfry"], None).unwrap();
        assert!(removed.contains("// 用户的 MCP"));
        assert_eq!(parse(&removed).unwrap()["providers"], json!({"mine":{}}));
        assert!(set("{broken}", &["model"], Some(&json!("m"))).is_err());
    }
}
