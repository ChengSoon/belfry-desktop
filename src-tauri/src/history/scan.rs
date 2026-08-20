//! 历史会话扫描共用的文件收集与安全删除。

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use crate::agent::validate_agent_session_id;
use crate::terminal::AppError;

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

pub fn codex_sessions_root() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".codex").join("sessions"))
}

pub fn claude_sessions_root() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".claude").join("projects"))
}

/// 递归收集根目录下的全部 `.jsonl` 文件，按路径排序保证扫描顺序稳定。
pub fn collect_jsonl_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    push_jsonl_files(root, &mut files);
    files.sort();
    files
}

fn push_jsonl_files(path: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => push_jsonl_files(&entry_path, files),
            Ok(kind)
                if kind.is_file()
                    && entry_path.extension().is_some_and(|value| value == "jsonl") =>
            {
                files.push(entry_path);
            }
            _ => {}
        }
    }
}

/// 会话 id 必须是普通文件名主干：不含路径分隔符、不含 `..`，防止把删除指向 sessions 根之外。
pub fn validate_session_id(value: &str) -> Result<(), AppError> {
    validate_agent_session_id(value).map_err(AppError::invalid_argument)
}

/// 删除单个会话文件，并把沿途变空的目录一并清掉（Codex 的日期目录、Claude 的项目目录）。
/// `root` 是安全边界：文件必须落在 root 之内，且只清理 root 以内的空目录。
pub fn remove_session_file(root: &Path, path: &Path) -> Result<(), AppError> {
    if !path.starts_with(root) {
        return Err(AppError::invalid_argument(
            "session file is outside the sessions root",
        ));
    }
    fs::remove_file(path).map_err(|error| AppError::io(error.to_string()))?;
    prune_empty_dirs(root, path);
    Ok(())
}

fn prune_empty_dirs(root: &Path, file: &Path) {
    let mut current = file.parent();
    while let Some(dir) = current {
        if !dir.starts_with(root) || dir == root {
            break;
        }
        match fs::remove_dir(dir) {
            Ok(()) => current = dir.parent(),
            // 目录非空或删除失败：往上已无意义，停在原地。
            Err(_) => break,
        }
    }
}

/// 文件 mtime 秒；读不到时返回 0，调用方自行降级。
pub fn modified_epoch(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|age| age.as_secs() as i64)
        .unwrap_or(0)
}

/// 逐行读取文件，`handle` 返回 true 时提前结束。
/// 会话日志单文件可能几 MB（含 base64 图片），列表只关心头部元数据，不该整读。
/// 单行可能超长，`read_until` 按字节推进，坏 UTF-8 用有损转换兜底，不会卡死。
pub fn read_lines_until<F>(path: &Path, max_lines: usize, mut handle: F)
where
    F: FnMut(&str) -> bool,
{
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    let mut reader = BufReader::new(file);
    let mut buffer = Vec::new();
    let mut read = 0usize;
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                read += 1;
                if read > max_lines || handle(String::from_utf8_lossy(&buffer).trim()) {
                    break;
                }
            }
        }
    }
}

/// 把首条用户消息压成适合列表展示的单行标题：折叠空白、去掉首尾、限长。
/// 只做文本整理，不截断多字节字符，也不会把单个超长词硬切。
pub fn normalize_title(text: &str) -> String {
    let mut out = String::new();
    for word in text.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        if out.chars().count() + word.chars().count() > 500 {
            break;
        }
        out.push_str(word);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("belfry-history-scan-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn collects_jsonl_files_recursively_and_ignores_others() {
        let root = temp_root("collect");
        std::fs::create_dir_all(root.join("2026/08")).unwrap();
        std::fs::write(root.join("a.jsonl"), "{}").unwrap();
        std::fs::write(root.join("2026/08/b.jsonl"), "{}").unwrap();
        std::fs::write(root.join("notes.md"), "x").unwrap();

        let files = collect_jsonl_files(&root);
        assert_eq!(files.len(), 2);
        assert!(files.iter().all(|p| p.extension().unwrap() == "jsonl"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_directory_yields_no_files() {
        assert!(collect_jsonl_files(Path::new("/__belfry_missing_history_dir__")).is_empty());
    }

    #[test]
    fn session_id_shape_is_validated() {
        assert!(validate_session_id("019ff0d5-dbaf-7893-96db-4fbbbfee03a7").is_ok());
        assert!(validate_session_id("").is_err());
        assert!(validate_session_id("a/b").is_err());
        assert!(validate_session_id("..").is_err());
        assert!(validate_session_id("../x").is_err());
        assert!(validate_session_id("a\\b").is_err());
        assert!(validate_session_id(".").is_err());
        assert!(validate_session_id("line\nbreak").is_err());
        assert!(validate_session_id("nul\0byte").is_err());
        assert!(validate_session_id(&"x".repeat(513)).is_err());
        assert!(validate_session_id(&"会".repeat(171)).is_err());
    }

    #[test]
    fn removal_prunes_empty_parent_dirs_only() {
        let root = temp_root("prune");
        let file = root.join("2026/08/session.jsonl");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "{}").unwrap();
        // 留一个兄弟文件：2026/08 不该被删，2026 也是。
        std::fs::write(root.join("2026/08/other.jsonl"), "{}").unwrap();

        remove_session_file(&root, &file).unwrap();
        assert!(!file.exists());
        assert!(root.join("2026/08/other.jsonl").exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn removal_prunes_all_empty_levels() {
        let root = temp_root("prune-all");
        let file = root.join("2026/08/session.jsonl");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "{}").unwrap();

        remove_session_file(&root, &file).unwrap();
        assert!(!file.exists());
        assert!(!root.join("2026/08").exists());
        assert!(!root.join("2026").exists());
        assert!(root.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_files_outside_the_root() {
        let root = temp_root("outside");
        let outside = root.with_file_name("elsewhere.jsonl");
        std::fs::write(&outside, "{}").unwrap();

        let result = remove_session_file(&root, &outside);
        assert!(result.is_err());
        assert!(outside.exists());

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&outside);
    }
}
