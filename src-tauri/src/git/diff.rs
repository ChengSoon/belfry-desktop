use std::path::{Component, Path};

use super::contracts::{DiffRequest, DiffStage, GitDiff, GitEntry};
use super::{command, status};
use crate::resource::canonicalize;
use crate::terminal::AppError;

const DIFF_OUTPUT_LIMIT: usize = 512 * 1024;
const DIFF_OPTIONS: &[&str] = &[
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-relative",
    "--unified=3",
];

pub(super) fn read(request: DiffRequest) -> Result<GitDiff, AppError> {
    validate_path(&request.path)?;
    let report = status::read(&request.root_path)?;
    if !report.repository {
        return Err(AppError::invalid_argument("当前目录不是 Git 工作树"));
    }
    let untracked = request.stage == DiffStage::Untracked;
    let Some(entry) = report
        .entries
        .iter()
        .find(|entry| entry.path == request.path && entry.untracked == untracked)
    else {
        return Ok(GitDiff::default());
    };
    let root = Path::new(&report.root_path);
    let args = diff_arguments(&request, entry, root)?;
    let output = command::run(root, &args, DIFF_OUTPUT_LIMIT)?;
    let normal_difference =
        request.stage == DiffStage::Untracked && output.status.code() == Some(1);
    if !output.status.success() && !normal_difference {
        return Err(AppError::io(format!(
            "Diff 读取失败：{}",
            output.error.trim()
        )));
    }
    let mut text = String::from_utf8_lossy(&output.bytes).into_owned();
    if output.truncated {
        text.truncate(text.rfind('\n').unwrap_or(0));
    }
    let binary = text
        .lines()
        .any(|line| line.starts_with("Binary files ") || line == "GIT binary patch");
    Ok(GitDiff {
        text,
        binary,
        truncated: output.truncated,
    })
}

fn diff_arguments<'a>(
    request: &'a DiffRequest,
    entry: &'a GitEntry,
    root: &Path,
) -> Result<Vec<&'a str>, AppError> {
    let mut args = DIFF_OPTIONS.to_vec();
    if request.stage == DiffStage::Untracked {
        if !entry.untracked {
            return Err(AppError::invalid_argument("文件已被跟踪，请刷新 Git 状态"));
        }
        validate_new_file(root, &request.path)?;
        args.extend(["--no-index", "--", "/dev/null", &request.path]);
        return Ok(args);
    }
    if request.stage == DiffStage::Staged {
        args.push("--cached");
    }
    args.extend(["--find-renames", "--", &request.path]);
    if let Some(original) = &entry.original_path {
        args.push(original);
    }
    Ok(args)
}

fn validate_new_file(root: &Path, path: &str) -> Result<(), AppError> {
    let file = canonicalize(&root.join(path))
        .map_err(|error| AppError::io(format!("文件无法读取：{error}")))?;
    if !file.starts_with(root) {
        return Err(AppError::invalid_argument("文件指向仓库之外，无法预览"));
    }
    if !file.is_file() {
        return Err(AppError::invalid_argument("该路径不是普通文件"));
    }
    Ok(())
}

fn validate_path(path: &str) -> Result<(), AppError> {
    let windows_root = path.starts_with('\\') || path.as_bytes().get(1) == Some(&b':');
    let forbidden = Path::new(path).components().any(|part| {
        matches!(
            part,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    });
    if path.is_empty() || path.contains('\0') || windows_root || forbidden {
        return Err(AppError::invalid_argument("Diff 路径必须位于仓库内"));
    }
    Ok(())
}
