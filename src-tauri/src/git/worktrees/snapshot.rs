use std::{collections::BTreeSet, fs, io::Read, path::Path};
use crate::{git::{command, status}, terminal::AppError};
use super::repository;

const SNAPSHOT_LIMIT: usize = 16 * 1024 * 1024;
const PREVIEW_LIMIT: usize = 256 * 1024;

#[derive(Debug, PartialEq)]
pub struct Snapshot {
    pub head: String, pub branch: String, pub status: String,
    pub staged: Vec<u8>, pub unstaged: Vec<u8>, pub untracked: Vec<(String, Vec<u8>)>, pub files: Vec<String>,
    pub contents: Vec<(String, Option<Vec<u8>>, bool)>,
}

pub fn capture(root: &Path) -> Result<Snapshot, AppError> {
    let report = status::read(&root.to_string_lossy())?;
    if report.truncated || report.entries.iter().any(|entry| entry.submodule || entry.conflicted) {
        return Err(AppError::invalid_argument("当前变更含冲突、子模块或超限文件，请先在终端处理"));
    }
    let staged = diff(root, true)?; let unstaged = diff(root, false)?;
    let mut total = staged.len() + unstaged.len();
    if total > SNAPSHOT_LIMIT { return Err(AppError::invalid_argument("变更超过完整预览上限")); }
    let mut untracked = vec![];
    for entry in report.entries.iter().filter(|entry| entry.untracked) {
        let bytes = read_untracked(&root.join(&entry.path))?; total += bytes.len();
        if total > SNAPSHOT_LIMIT { return Err(AppError::invalid_argument("变更超过 16 MiB 预览上限，请在终端处理")); }
        untracked.push((entry.path.clone(), bytes));
    }
    let paths = report.entries.iter().flat_map(|entry| std::iter::once(entry.path.clone()).chain(entry.original_path.clone())).collect::<BTreeSet<_>>();
    let mut contents = vec![];
    for path in paths {
        let full = root.join(&path);
        let (bytes, executable) = read_contents(&full)?;
        total += bytes.as_ref().map_or(0, Vec::len);
        if total > SNAPSHOT_LIMIT { return Err(AppError::invalid_argument("变更超过完整预览上限")); }
        contents.push((path, bytes, executable));
    }
    Ok(Snapshot { head: report.head.unwrap_or_default(), branch: report.branch.unwrap_or_default(),
        status: repository::text(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])? ,
        staged, unstaged, untracked, contents, files: report.entries.into_iter().map(|entry| entry.path).collect() })
}

pub fn preview(snapshot: &Snapshot) -> String {
    let mut text = format!("已暂存\n{}\n未暂存\n{}", String::from_utf8_lossy(&snapshot.staged), String::from_utf8_lossy(&snapshot.unstaged));
    for (path, bytes) in &snapshot.untracked {
        text.push_str(&format!("\n新文件：{path}\n{}", std::str::from_utf8(bytes).unwrap_or("[二进制文件，请在文件视图检查]")));
    }
    if text.len() <= PREVIEW_LIMIT { return text; }
    let mut end = PREVIEW_LIMIT; while !text.is_char_boundary(end) { end -= 1; }
    format!("{}\n…预览已截断；请结合文件列表在终端审查完整内容。", &text[..end])
}

pub fn assert_same(root: &Path, expected: &Snapshot) -> Result<(), AppError> {
    if &capture(root)? != expected { return Err(AppError::invalid_argument("预览后 Git 状态或文件内容已变化，请重新预览")); }
    Ok(())
}

pub fn assert_clean(root: &Path) -> Result<Snapshot, AppError> {
    repository::assert_idle(root)?;
    let snapshot = capture(root)?;
    if !snapshot.files.is_empty() { return Err(AppError::invalid_argument("工作树有未提交改动，请先提交或在终端处理")); }
    Ok(snapshot)
}

fn diff(root: &Path, staged: bool) -> Result<Vec<u8>, AppError> {
    let mut args = vec!["diff", "--binary", "--no-ext-diff", "--no-textconv", "--no-color"];
    if staged { args.push("--cached"); }
    let output = command::run(root, &args, SNAPSHOT_LIMIT)?;
    if !output.status.success() || output.truncated { return Err(AppError::io("无法完整读取变更预览，请在终端审查")); }
    Ok(output.bytes)
}

fn read_untracked(path: &Path) -> Result<Vec<u8>, AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| AppError::io(error.to_string()))?;
    if metadata.file_type().is_symlink() {
        return fs::read_link(path).map(|path| path.to_string_lossy().as_bytes().to_vec()).map_err(|error| AppError::io(error.to_string()));
    }
    if !metadata.is_file() || metadata.len() > SNAPSHOT_LIMIT as u64 { return Err(AppError::invalid_argument("新文件类型或大小不适合向导预览")); }
    let mut bytes = vec![];
    fs::File::open(path).and_then(|file| file.take((SNAPSHOT_LIMIT + 1) as u64).read_to_end(&mut bytes))
        .map_err(|error| AppError::io(error.to_string()))?;
    if bytes.len() > SNAPSHOT_LIMIT { return Err(AppError::invalid_argument("文件在读取中超过上限")); }
    Ok(bytes)
}

fn read_contents(path: &Path) -> Result<(Option<Vec<u8>>, bool), AppError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((None, false)),
        Err(error) => return Err(AppError::io(error.to_string())),
    };
    #[cfg(unix)] let executable = { use std::os::unix::fs::PermissionsExt; metadata.permissions().mode() & 0o111 != 0 };
    #[cfg(not(unix))] let executable = false;
    let _ = metadata;
    Ok((Some(read_untracked(path)?), executable))
}
