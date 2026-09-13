use std::path::{Path, PathBuf};
use crate::{git::{command, status}, terminal::AppError};
use super::{contracts::*, repository as repo, snapshot::{self, Snapshot}};

pub struct PlannedAction {
    pub tree: ManagedWorktree, pub action: Action, pub source: Snapshot,
    pub target: Option<(String, Snapshot)>, pub message: String,
}

pub fn prepare(tree: ManagedWorktree, input: ActionInput) -> Result<PlannedAction, AppError> {
    verify_owned(&tree)?;
    let root = Path::new(&tree.root_path); repo::assert_idle(root)?;
    let source = snapshot::capture(root)?;
    let message = input.message.unwrap_or_default().trim().to_owned();
    if input.action == Action::Commit {
        if message.is_empty() || message.len() > 500 || message.contains(['\0', '\r']) { return Err(AppError::invalid_argument("请输入有效提交说明（最多 500 字节）")); }
        if source.files.is_empty() { return Err(AppError::invalid_argument("没有需要提交的变更")); }
        return Ok(PlannedAction { tree, action: input.action, source, target: None, message });
    }
    if !source.files.is_empty() { return Err(AppError::invalid_argument("任务目录有未提交改动，请先提交")); }
    let target_path = input.target_path.ok_or_else(|| AppError::invalid_argument("请选择已检出的目标分支"))?;
    let target_repo = repo::inspect(&target_path)?;
    if target_repo.common != tree.common_dir || target_repo.branch == tree.branch {
        return Err(AppError::invalid_argument("目标须为同一仓库中的另一分支"));
    }
    let target = snapshot::assert_clean(&target_repo.root)?;
    if input.action == Action::Cleanup { assert_removable(&tree, &target.head)?; }
    Ok(PlannedAction { tree, action: input.action, source,
        target: Some((target_repo.root.to_string_lossy().into_owned(), target)), message })
}

pub fn verify_owned(tree: &ManagedWorktree) -> Result<(), AppError> {
    let current = repo::inspect(&tree.root_path)?;
    if current.common != tree.common_dir || current.branch != tree.branch || tree.state == "removed" {
        return Err(AppError::invalid_argument("工作树的仓库、分支或归属已变化，已停止操作"));
    }
    let listed = repo::worktrees(&current.root)?;
    let own = listed.iter().find(|entry| crate::resource::canonicalize(&PathBuf::from(&entry.root_path)).ok().as_ref() == Some(&current.root));
    if !own.is_some_and(|entry| !entry.locked && entry.branch.as_deref() == Some(tree.branch.as_str())) {
        return Err(AppError::invalid_argument("工作树被锁定、移动或不再登记，已停止操作"));
    }
    Ok(())
}

pub fn execute(plan: PlannedAction, busy: &impl Fn(&Path) -> bool) -> Result<ActionResult, AppError> {
    verify_owned(&plan.tree)?;
    let root = Path::new(&plan.tree.root_path);
    repo::assert_idle(root)?; snapshot::assert_same(root, &plan.source)?;
    if let Some((target, expected)) = &plan.target {
        repo::assert_idle(Path::new(target))?; snapshot::assert_same(Path::new(target), expected)?;
    }
    match plan.action {
        Action::Commit => commit(plan),
        Action::Merge => merge(plan, busy),
        Action::Cleanup => cleanup(plan, busy),
    }
}

fn commit(plan: PlannedAction) -> Result<ActionResult, AppError> {
    let root = Path::new(&plan.tree.root_path);
    repo::success(repo::mutation(root, &["add", "-A", "--", "."])?)?;
    let staged = snapshot::capture(root)?;
    if staged.contents != plan.source.contents || staged.head != plan.source.head {
        return Err(AppError::invalid_argument("暂存期间文件内容已变化，已保留暂存状态，请重新预览"));
    }
    let unchanged = command::run(root, &["diff", "--quiet", "--no-ext-diff", "--no-textconv"], repo::READ_LIMIT)?;
    if !unchanged.status.success() || repo::inspect(&plan.tree.root_path)?.head != plan.source.head {
        return Err(AppError::invalid_argument("暂存期间文件或 HEAD 已变化，已保留暂存内容，请重新审查"));
    }
    repo::success(repo::mutation(root, &["commit", "--no-gpg-sign", "-m", &plan.message])?)?;
    Ok(ActionResult { message: "任务变更已提交。".into(), worktree: Some(plan.tree), conflicts: vec![] })
}

fn merge(plan: PlannedAction, busy: &impl Fn(&Path) -> bool) -> Result<ActionResult, AppError> {
    let (target, _) = plan.target.as_ref().expect("merge target");
    if busy(Path::new(target)) { return Err(AppError::invalid_argument("目标工作树还有运行中的 Belfry 会话，请先结束会话")); }
    let output = repo::mutation(Path::new(target), &["merge", "--no-edit", "--no-gpg-sign", "--no-autostash", &plan.source.head])?;
    if !output.status.success() {
        let conflicts = status::read(target)?.entries.into_iter().filter(|entry| entry.conflicted).map(|entry| entry.path).collect::<Vec<_>>();
        if conflicts.is_empty() { return Err(AppError::io(format!("合并未完成：{}；现有文件已保留", output.error.trim()))); }
        return Ok(ActionResult { message: "合并遇到冲突，已停止。请在目标目录处理，任务分支与文件均已保留。".into(),
            worktree: Some(plan.tree), conflicts });
    }
    Ok(ActionResult { message: "已合并到目标分支，可以继续预览清理。".into(), worktree: Some(plan.tree), conflicts: vec![] })
}

fn cleanup(mut plan: PlannedAction, busy: &impl Fn(&Path) -> bool) -> Result<ActionResult, AppError> {
    let (target, expected) = plan.target.as_ref().expect("cleanup target");
    let root = Path::new(&plan.tree.root_path);
    if busy(root) { return Err(AppError::invalid_argument("任务目录还有运行中的 Belfry 会话，请先结束会话")); }
    assert_removable(&plan.tree, &expected.head)?;
    repo::success(repo::mutation(Path::new(target), &["worktree", "remove", "--", &plan.tree.root_path])?)?;
    plan.tree.state = "removed".into();
    Ok(ActionResult { message: "已清理工作树目录，任务分支仍保留。".into(), worktree: Some(plan.tree), conflicts: vec![] })
}

fn assert_removable(tree: &ManagedWorktree, target_head: &str) -> Result<(), AppError> {
    let root = Path::new(&tree.root_path);
    let source = snapshot::assert_clean(root)?;
    let merged = command::run(root, &["merge-base", "--is-ancestor", &source.head, target_head], repo::READ_LIMIT)?;
    if !merged.status.success() { return Err(AppError::invalid_argument("任务含尚未合并到目标的提交，不能清理")); }
    if !repo::text(root, &["clean", "-ndx"])?.trim().is_empty() {
        return Err(AppError::invalid_argument("目录仍含未跟踪或忽略文件，请先自行检查与处理后再清理"));
    }
    Ok(())
}
