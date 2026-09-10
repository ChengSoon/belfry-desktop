use super::{DiffHunk, DiffLine, DiffLineKind, DiffPreview};

const CONTEXT: usize = 3;
const MAX_HUNKS: usize = 32;
const MAX_HUNK_LINES: usize = 200;
const MAX_PREVIEW_BYTES: usize = 64 * 1024;
const MAX_LCS_CELLS: usize = 1_000_000;
const MAX_LINE_BYTES: usize = 2 * 1024;

#[derive(Clone)]
struct Op<'a> {
    kind: DiffLineKind,
    old: Option<usize>,
    new: Option<usize>,
    text: &'a str,
}

pub(super) fn build(old: &str, new: &str) -> DiffPreview {
    let old_lines = lines(old);
    let new_lines = lines(new);
    let ops = operations(&old_lines, &new_lines);
    bound(group(ops))
}

fn lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return vec![];
    }
    text.split_terminator('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

fn operations<'a>(old: &[&'a str], new: &[&'a str]) -> Vec<Op<'a>> {
    if old.len().saturating_mul(new.len()) > MAX_LCS_CELLS {
        return fallback(old, new);
    }
    let width = new.len() + 1;
    let mut table = vec![0_u32; (old.len() + 1) * width];
    for i in (0..old.len()).rev() {
        for j in (0..new.len()).rev() {
            table[i * width + j] = if old[i] == new[j] {
                table[(i + 1) * width + j + 1] + 1
            } else {
                table[(i + 1) * width + j].max(table[i * width + j + 1])
            };
        }
    }
    let (mut i, mut j, mut result) = (0, 0, Vec::new());
    while i < old.len() || j < new.len() {
        if i < old.len() && j < new.len() && old[i] == new[j] {
            result.push(Op {
                kind: DiffLineKind::Context,
                old: Some(i + 1),
                new: Some(j + 1),
                text: old[i],
            });
            i += 1;
            j += 1;
        } else if j < new.len()
            && (i == old.len() || table[i * width + j + 1] >= table[(i + 1) * width + j])
        {
            result.push(Op {
                kind: DiffLineKind::Add,
                old: None,
                new: Some(j + 1),
                text: new[j],
            });
            j += 1;
        } else {
            result.push(Op {
                kind: DiffLineKind::Delete,
                old: Some(i + 1),
                new: None,
                text: old[i],
            });
            i += 1;
        }
    }
    result
}

fn fallback<'a>(old: &[&'a str], new: &[&'a str]) -> Vec<Op<'a>> {
    old.iter()
        .enumerate()
        .map(|(i, text)| Op {
            kind: DiffLineKind::Delete,
            old: Some(i + 1),
            new: None,
            text,
        })
        .chain(new.iter().enumerate().map(|(i, text)| Op {
            kind: DiffLineKind::Add,
            old: None,
            new: Some(i + 1),
            text,
        }))
        .collect()
}

fn group(ops: Vec<Op<'_>>) -> Vec<Vec<Op<'_>>> {
    let changed: Vec<_> = ops
        .iter()
        .enumerate()
        .filter_map(|(i, op)| (!matches!(op.kind, DiffLineKind::Context)).then_some(i))
        .collect();
    if changed.is_empty() {
        return vec![];
    }
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for index in changed {
        let start = index.saturating_sub(CONTEXT);
        let end = (index + CONTEXT + 1).min(ops.len());
        if let Some(last) = ranges.last_mut().filter(|last| start <= last.1) {
            last.1 = last.1.max(end);
        } else {
            ranges.push((start, end));
        }
    }
    ranges
        .into_iter()
        .map(|(start, end)| ops[start..end].to_vec())
        .collect()
}

fn bound(groups: Vec<Vec<Op<'_>>>) -> DiffPreview {
    let total_hunks = groups.len();
    let total_lines: usize = groups.iter().map(Vec::len).sum();
    let mut hunks = Vec::new();
    let mut bytes = 0;
    let mut included_lines = 0;
    'outer: for group in groups.into_iter().take(MAX_HUNKS) {
        let mut lines = Vec::new();
        for op in group.into_iter().take(MAX_HUNK_LINES) {
            let content = visible(op.text);
            let cost = content.len();
            if bytes + cost > MAX_PREVIEW_BYTES {
                break 'outer;
            }
            bytes += cost;
            included_lines += 1;
            lines.push(DiffLine {
                kind: op.kind,
                old_line: op.old,
                new_line: op.new,
                content,
            });
        }
        if !lines.is_empty() {
            hunks.push(DiffHunk {
                old_start: lines.iter().find_map(|l| l.old_line).unwrap_or(0),
                new_start: lines.iter().find_map(|l| l.new_line).unwrap_or(0),
                lines,
            });
        }
    }
    DiffPreview {
        truncated: hunks.len() < total_hunks || included_lines < total_lines,
        omitted_hunks: total_hunks.saturating_sub(hunks.len()),
        omitted_lines: total_lines.saturating_sub(included_lines),
        hunks,
        preview_bytes: bytes,
    }
}

fn visible(text: &str) -> String {
    let mut result = String::new();
    for ch in text.chars() {
        let hidden = ch.is_control()
            || matches!(ch as u32, 0x061c | 0x200e | 0x200f | 0x202a..=0x202e | 0x2066..=0x2069);
        let piece = if hidden {
            format!("\\u{{{:04x}}}", ch as u32)
        } else {
            ch.to_string()
        };
        if result.len() + piece.len() > MAX_LINE_BYTES {
            result.push_str("…");
            break;
        }
        result.push_str(&piece);
    }
    result
}
