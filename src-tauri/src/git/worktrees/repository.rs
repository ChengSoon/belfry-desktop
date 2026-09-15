use std::path::{Path, PathBuf};
use super::contracts::{ExistingWorktree, WorktreeReport};
use crate::{git::{command, status}, resource::canonicalize, terminal::AppError};

pub const READ_LIMIT: usize = 2 * 1024 * 1024;
pub struct Repository { pub root: PathBuf, pub common: String, pub branch: String, pub head: String }

pub fn text(root: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = command::run(root, args, READ_LIMIT)?;
    if !output.status.success() { return Err(AppError::io(format!("Git 操作失败：{}", output.error.trim()))); }
    if output.truncated { return Err(AppError::io("Git 输出超过预览上限，请在终端处理")); }
    String::from_utf8(output.bytes).map_err(|_| AppError::io("Git 输出不是有效 UTF-8"))
}

pub fn inspect(path: &str) -> Result<Repository, AppError> {
    let report = status::read(path)?;
    if !report.repository { return Err(AppError::invalid_argument("当前目录不是 Git 工作树")); }
    let root = PathBuf::from(report.root_path);
    let common = text(&root, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
    let common = canonicalize(Path::new(common.trim_end_matches(['\r', '\n'])))
        .map_err(|error| AppError::io(error.to_string()))?.to_string_lossy().into_owned();
    let branch = report.branch.filter(|value| value != "(detached)")
        .ok_or_else(|| AppError::invalid_argument("请先切换到命名分支后操作 Worktree"))?;
    let head = report.head.ok_or_else(|| AppError::invalid_argument("仓库尚无提交，请先创建初始提交"))?;
    Ok(Repository { root, common, branch, head })
}

pub fn report(path: &str) -> Result<(Repository, WorktreeReport), AppError> {
    let repo = inspect(path)?;
    let branches = text(&repo.root, &["for-each-ref", "--format=%(refname:short)", "refs/heads/"])?
        .lines().map(str::to_owned).collect();
    let worktrees = worktrees(&repo.root)?;
    let result = WorktreeReport { root_path: repo.root.to_string_lossy().into_owned(),
        branch: repo.branch.clone(), branches, worktrees, managed: vec![] };
    Ok((repo, result))
}

pub fn worktrees(root: &Path) -> Result<Vec<ExistingWorktree>, AppError> {
    let raw = text(root, &["worktree", "list", "--porcelain", "-z"])?;
    Ok(raw.split("\0\0").filter_map(|entry| {
        let fields: Vec<_> = entry.split('\0').collect();
        let path = fields.iter().find_map(|line| line.strip_prefix("worktree "))?;
        Some(ExistingWorktree { root_path: path.into(),
            branch: fields.iter().find_map(|line| line.strip_prefix("branch refs/heads/")).map(str::to_owned),
            head: fields.iter().find_map(|line| line.strip_prefix("HEAD ")).unwrap_or("").into(),
            locked: fields.iter().any(|line| line.starts_with("locked") || line.starts_with("prunable")),
        })
    }).collect())
}

pub fn validate_branch(root: &Path, branch: &str) -> Result<(), AppError> {
    const INVALID_REF_EXIT_CODE: i32 = 1;
    const INVALID_BRANCH: &str = "分支名称无效，请修改后重试";
    if branch.is_empty() || branch.len() > 160 || branch.starts_with('-') || branch.chars().any(char::is_whitespace) {
        return Err(AppError::invalid_argument(INVALID_BRANCH));
    }
    let output = command::run(root, &["check-ref-format", &format!("refs/heads/{branch}")], READ_LIMIT)?;
    // Git 校验失败时可能没有 stderr，不能只展示一个空的通用错误。
    if output.status.code() == Some(INVALID_REF_EXIT_CODE) {
        return Err(AppError::invalid_argument(INVALID_BRANCH));
    }
    success(output)
}

pub fn branch_head(root: &Path, branch: &str) -> Result<String, AppError> {
    validate_branch(root, branch)?;
    text(root, &["rev-parse", "--verify", &format!("refs/heads/{branch}^{{commit}}")]).map(|value| value.trim().into())
}

pub fn assert_idle(root: &Path) -> Result<(), AppError> {
    let status = text(root, &["status", "--untracked-files=no"])?;
    if ["rebase in progress", "currently rebasing", "currently cherry-picking", "currently reverting", "still merging", "unmerged paths"]
        .iter().any(|needle| status.to_lowercase().contains(needle)) {
        return Err(AppError::invalid_argument("存在未完成的合并、变基或冲突，请先在终端处理"));
    }
    Ok(())
}

pub fn mutation(root: &Path, args: &[&str]) -> Result<command::Output, AppError> {
    #[cfg(windows)] let no_hooks = "core.hooksPath=NUL";
    #[cfg(not(windows))] let no_hooks = "core.hooksPath=/dev/null";
    let mut all = vec!["-c", no_hooks, "-c", "commit.gpgsign=false", "-c", "merge.autoStash=false"];
    all.extend_from_slice(args);
    command::run(root, &all, READ_LIMIT)
}

pub fn success(output: command::Output) -> Result<(), AppError> {
    if output.status.success() { Ok(()) }
    else { Err(AppError::io(format!("Git 未完成操作，文件与暂存状态已保留：{}", output.error.trim()))) }
}
