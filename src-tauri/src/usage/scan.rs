//! 会话日志的文件遍历与逐行读取。
//!
//! 日志会长到几十 MB，全部读进内存不合适，这里统一走 BufReader 逐行。
//! 两级预筛把绝大多数行挡在 JSON 解析之前：mtime 早于窗口起点的文件整个跳过，
//! 行内不含关键字的直接丢弃。

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Default)]
pub struct ScanTally {
    pub scanned: u32,
    pub skipped: u32,
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

/// 递归收集扩展名为 jsonl 的文件。目录不存在时返回空表，代表该 Agent 没被用过。
pub fn collect_jsonl_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    push_jsonl_files(root, &mut files);
    files.sort();
    files
}

fn push_jsonl_files(directory: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            // 只跟随目录项自身的类型，不解析符号链接，避免环形链接导致无限递归。
            Ok(kind) if kind.is_dir() => push_jsonl_files(&path, files),
            Ok(kind) if kind.is_file() => {
                if path.extension().is_some_and(|value| value == "jsonl") {
                    files.push(path);
                }
            }
            _ => {}
        }
    }
}

/// 文件最后修改时间早于 `cutoff` 时可整体跳过：其中每条记录都不可能落在窗口内。
/// 读不到 mtime 时保守返回 false，宁可多扫也不漏。
pub fn is_stale(path: &Path, cutoff: Option<i64>) -> bool {
    let Some(cutoff) = cutoff else {
        return false;
    };
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .is_some_and(|age| (age.as_secs() as i64) < cutoff)
}

/// 逐行读取并把含任一关键字的行交给 `handle`。
///
/// 单行可能长达数 MB（含 base64 图片），用 `read_until` 逐行读并复用缓冲。
/// 这里刻意不用 `read_line`：它遇到非 UTF-8 会返回 `Err` 且**不消耗**已读字节，
/// 外层若 `continue` 就会在坏字节上死循环。`read_until` 按字节推进，再做有损转换。
pub fn for_each_line<F>(path: &Path, keywords: &[&str], mut handle: F) -> bool
where
    F: FnMut(&str),
{
    let Ok(file) = File::open(path) else {
        return false;
    };
    let mut reader = BufReader::new(file);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) => break,
            Ok(_) => {
                let text = String::from_utf8_lossy(&buffer);
                let trimmed = text.trim();
                if !trimmed.is_empty() && keywords.iter().any(|key| trimmed.contains(key)) {
                    handle(trimmed);
                }
            }
            // 真正的 IO 错误（如设备读失败）：放弃余下内容，已累加的部分仍有效。
            Err(_) => break,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("belfry-usage-scan-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn collects_jsonl_files_recursively_and_ignores_other_extensions() {
        let dir = temp_dir("collect");
        std::fs::create_dir_all(dir.join("2026/08")).unwrap();
        std::fs::write(dir.join("a.jsonl"), "{}").unwrap();
        std::fs::write(dir.join("2026/08/b.jsonl"), "{}").unwrap();
        std::fs::write(dir.join("notes.md"), "x").unwrap();
        std::fs::write(dir.join("state.json"), "{}").unwrap();

        let files = collect_jsonl_files(&dir);
        assert_eq!(files.len(), 2);
        assert!(files.iter().all(|p| p.extension().unwrap() == "jsonl"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_directory_yields_no_files() {
        assert!(collect_jsonl_files(Path::new("/__belfry_missing_usage_dir__")).is_empty());
    }

    #[test]
    fn keyword_prefilter_only_forwards_matching_lines() {
        let dir = temp_dir("filter");
        let path = dir.join("log.jsonl");
        std::fs::write(&path, "{\"usage\":1}\n\n{\"other\":2}\n{\"usage\":3}\n").unwrap();

        let mut seen = Vec::new();
        assert!(for_each_line(&path, &["\"usage\""], |line| seen
            .push(line.to_string())));
        assert_eq!(seen.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_utf8_does_not_stall_the_scan() {
        let dir = temp_dir("utf8");
        let path = dir.join("log.jsonl");
        // 中间一行是坏字节：必须跳过它并读到后面的好行，且不能死循环。
        let mut bytes = b"{\"usage\":1}\n".to_vec();
        bytes.extend_from_slice(&[0xff, 0xfe, b'\n']);
        bytes.extend_from_slice(b"{\"usage\":2}\n");
        std::fs::write(&path, bytes).unwrap();

        let mut seen = 0;
        assert!(for_each_line(&path, &["\"usage\""], |_| seen += 1));
        assert_eq!(seen, 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_unreadable_file_instead_of_panicking() {
        assert!(!for_each_line(
            Path::new("/__belfry_missing_usage_file__.jsonl"),
            &["x"],
            |_| {}
        ));
    }

    #[test]
    fn freshly_written_file_is_not_stale_and_no_cutoff_never_skips() {
        let dir = temp_dir("stale");
        let path = dir.join("log.jsonl");
        std::fs::write(&path, "{}").unwrap();

        assert!(!is_stale(&path, None));
        assert!(!is_stale(&path, Some(0)));
        // 未来的 cutoff：刚写的文件必然早于它
        assert!(is_stale(&path, Some(i64::MAX / 2)));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
