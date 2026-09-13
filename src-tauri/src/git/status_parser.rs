use super::contracts::{GitEntry, GitStatus};
use crate::terminal::AppError;

pub(super) fn parse(bytes: &[u8], report: &mut GitStatus) -> Result<(), AppError> {
    let mut records = bytes.split_inclusive(|byte| *byte == 0);
    while let Some(raw) = records.next() {
        if !raw.ends_with(&[0]) {
            report.truncated = true;
            break;
        }
        let line = decode(&raw[..raw.len() - 1])?;
        if line.starts_with("# ") {
            header(line, report);
            continue;
        }
        let Some(mut entry) = parse_entry(line)? else {
            continue;
        };
        if line.starts_with("2 ") {
            let Some(original) = records.next().filter(|raw| raw.ends_with(&[0])) else {
                report.truncated = true;
                break;
            };
            entry.original_path = Some(decode(&original[..original.len() - 1])?.to_owned());
        }
        report.entries.push(entry);
    }
    Ok(())
}

fn header(line: &str, report: &mut GitStatus) {
    if let Some(value) = line.strip_prefix("# branch.head ") {
        report.branch = Some(value.into());
    }
    if let Some(value) = line
        .strip_prefix("# branch.oid ")
        .filter(|value| *value != "(initial)")
    {
        report.head = Some(value.into());
    }
    if let Some(value) = line.strip_prefix("# branch.upstream ") {
        report.upstream = Some(value.into());
    }
    if let Some(value) = line.strip_prefix("# branch.ab ") {
        let mut counts = value.split_whitespace();
        report.ahead = counts
            .next()
            .and_then(|v| v.trim_start_matches('+').parse().ok())
            .unwrap_or(0);
        report.behind = counts
            .next()
            .and_then(|v| v.trim_start_matches('-').parse().ok())
            .unwrap_or(0);
    }
}

fn parse_entry(line: &str) -> Result<Option<GitEntry>, AppError> {
    let kind = line.as_bytes().first().copied();
    if let Some(path) = line.strip_prefix("? ") {
        return Ok(Some(entry(path, "??", false, true)));
    }
    let field_count = match kind {
        Some(b'1') => 9,
        Some(b'2') => 10,
        Some(b'u') => 11,
        _ => return Ok(None),
    };
    let fields: Vec<_> = line.splitn(field_count, ' ').collect();
    if fields.len() != field_count || fields[1].len() != 2 {
        return Err(AppError::io("Git 状态格式无法识别"));
    }
    let mut entry = entry(
        fields[field_count - 1],
        fields[1],
        fields[2].starts_with('S'),
        false,
    );
    entry.conflicted = kind == Some(b'u');
    Ok(Some(entry))
}

fn entry(path: &str, status: &str, submodule: bool, untracked: bool) -> GitEntry {
    let mut codes = status.chars();
    GitEntry {
        path: path.into(),
        original_path: None,
        index_status: codes.next().unwrap_or('.').to_string(),
        worktree_status: codes.next().unwrap_or('.').to_string(),
        untracked,
        conflicted: false,
        submodule,
    }
}

fn decode(bytes: &[u8]) -> Result<&str, AppError> {
    std::str::from_utf8(bytes).map_err(|_| AppError::io("Git 文件路径不是有效 UTF-8，无法安全展示"))
}
