use super::{contracts::*, service::WorktreeService};
use crate::git::fixtures::Repository;
use std::path::PathBuf;

struct Fixture { repo: Repository, data: PathBuf, service: WorktreeService }
impl Fixture {
    fn new() -> Self {
        let repo = Repository::new(); repo.write("hello.txt", "base\n"); repo.commit();
        let data = std::env::temp_dir().join(format!("belfry-worktree-test-{}", ulid::Ulid::generate()));
        let service = WorktreeService::new(data.clone());
        Self { repo, data, service }
    }
    fn create(&mut self, name: &str) -> ManagedWorktree {
        let preview = self.service.preview(CreateInput { root_path: self.repo.path().into(), name: name.into(),
            branch: format!("task/{}", name.replace(' ', "-")), base_branch: "main".into() }).unwrap();
        self.service.execute(&preview.token, |_| false).unwrap().worktree.unwrap()
    }
    fn action(&mut self, tree: &ManagedWorktree, action: Action) -> Result<ActionResult, crate::terminal::AppError> {
        let preview = self.service.preview_action(ActionInput { id: tree.id.clone(), action,
            message: Some("feat: task result".into()), target_path: Some(self.repo.path().into()) })?;
        self.service.execute(&preview.token, |_| false)
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.data); } }

#[test]
fn two_tasks_have_independent_files_branches_and_persistent_ownership() {
    let mut f = Fixture::new(); let a = f.create("任务 A"); let b = f.create("任务 B");
    std::fs::write(PathBuf::from(&a.root_path).join("hello.txt"), "only A").unwrap();
    assert_eq!("base\n", std::fs::read_to_string(PathBuf::from(&b.root_path).join("hello.txt")).unwrap());
    assert_eq!("base\n", std::fs::read_to_string(f.repo.root.join("hello.txt")).unwrap());
    let report = WorktreeService::new(f.data.clone()).list(f.repo.path()).unwrap();
    assert_eq!(2, report.managed.len()); assert_ne!(a.branch, b.branch);
}

#[test]
fn stale_duplicate_invalid_and_consumed_creations_are_rejected() {
    let mut f = Fixture::new(); f.create("same");
    assert!(f.service.preview(CreateInput { root_path: f.repo.path().into(), name: "same".into(),
        branch: "task/second".into(), base_branch: "main".into() }).is_err());
    for name in ["../escape", "-flag", "CON", "bad/name"] {
        assert!(f.service.preview(CreateInput { root_path: f.repo.path().into(), name: name.into(),
            branch: "task/new".into(), base_branch: "main".into() }).is_err());
    }
    let preview = f.service.preview(CreateInput { root_path: f.repo.path().into(), name: "stale".into(),
        branch: "task/stale".into(), base_branch: "main".into() }).unwrap();
    f.repo.write("new.txt", "moved HEAD"); f.repo.commit();
    assert!(f.service.execute(&preview.token, |_| false).is_err());
    assert!(f.service.execute(&preview.token, |_| false).is_err());
}

#[test]
fn invalid_git_branch_names_have_actionable_errors_without_creating_worktrees() {
    let mut f = Fixture::new();
    for branch in ["bad..branch", "task/@{invalid", "task/.hidden", "task/ending.lock"] {
        let error = f.service.preview(CreateInput {
            root_path: f.repo.path().into(), name: "invalid branch".into(),
            branch: branch.into(), base_branch: "main".into(),
        }).unwrap_err();
        assert_eq!("分支名称无效，请修改后重试", error.message);
        assert!(f.service.list(f.repo.path()).unwrap().managed.is_empty());
        assert_eq!(1, f.service.list(f.repo.path()).unwrap().worktrees.len());
    }
}

#[test]
fn dirty_target_blocks_merge_and_unmerged_or_busy_tree_blocks_cleanup() {
    let mut f = Fixture::new(); let tree = f.create("dirty");
    std::fs::write(PathBuf::from(&tree.root_path).join("hello.txt"), "task\n").unwrap();
    f.action(&tree, Action::Commit).unwrap();
    assert!(f.action(&tree, Action::Cleanup).is_err());
    f.repo.write("untracked", "keep me");
    assert!(f.action(&tree, Action::Merge).is_err());
    std::fs::remove_file(f.repo.root.join("untracked")).unwrap();
    f.action(&tree, Action::Merge).unwrap();
    let preview = f.service.preview_action(ActionInput { id: tree.id.clone(), action: Action::Cleanup,
        message: None, target_path: Some(f.repo.path().into()) }).unwrap();
    assert!(f.service.execute(&preview.token, |_| true).is_err());
    assert!(PathBuf::from(&tree.root_path).exists());
    f.action(&tree, Action::Cleanup).unwrap();
    assert!(!PathBuf::from(&tree.root_path).exists());
    assert!(f.repo.try_git(&["show-ref", "--verify", "refs/heads/task/dirty"]).status.success());
}

#[test]
fn conflict_stops_and_preserves_both_commits_and_worktree() {
    let mut f = Fixture::new(); let tree = f.create("conflict");
    std::fs::write(PathBuf::from(&tree.root_path).join("hello.txt"), "task version\n").unwrap();
    f.action(&tree, Action::Commit).unwrap();
    f.repo.write("hello.txt", "main version\n"); f.repo.commit();
    let result = f.action(&tree, Action::Merge).unwrap();
    assert_eq!(vec!["hello.txt"], result.conflicts);
    assert!(PathBuf::from(&tree.root_path).exists());
    let contents = std::fs::read_to_string(f.repo.root.join("hello.txt")).unwrap();
    assert!(contents.contains("task version") && contents.contains("main version"));
    assert!(f.action(&tree, Action::Cleanup).is_err());
}

#[test]
fn changed_preview_and_empty_commit_are_rejected_without_losing_files() {
    let mut f = Fixture::new(); let tree = f.create("changed");
    assert!(f.action(&tree, Action::Commit).is_err());
    let path = PathBuf::from(&tree.root_path).join("hello.txt");
    std::fs::write(&path, "before preview").unwrap();
    let preview = f.service.preview_action(ActionInput { id: tree.id, action: Action::Commit,
        message: Some("feat: preview".into()), target_path: None }).unwrap();
    std::fs::write(&path, "after preview").unwrap();
    assert!(f.service.execute(&preview.token, |_| false).is_err());
    assert_eq!("after preview", std::fs::read_to_string(path).unwrap());
}

#[test]
fn ignored_files_and_foreign_identifiers_cannot_be_cleaned() {
    let mut f = Fixture::new(); f.repo.write(".gitignore", "private.env\n"); f.repo.commit();
    let tree = f.create("ignored");
    let private = PathBuf::from(&tree.root_path).join("private.env");
    std::fs::write(&private, "retain this local file").unwrap();
    assert!(f.action(&tree, Action::Cleanup).is_err());
    assert_eq!("retain this local file", std::fs::read_to_string(private).unwrap());
    assert!(f.service.preview_action(ActionInput { id: "not-owned".into(), action: Action::Cleanup,
        message: None, target_path: Some(f.repo.path().into()) }).is_err());
}

#[test]
fn directory_created_after_preview_is_never_overwritten() {
    let mut f = Fixture::new();
    let preview = f.service.preview(CreateInput { root_path: f.repo.path().into(), name: "race".into(),
        branch: "task/race".into(), base_branch: "main".into() }).unwrap();
    let path = PathBuf::from(&preview.root_path); std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("keep.txt"), "untouched").unwrap();
    assert!(f.service.execute(&preview.token, |_| false).is_err());
    assert_eq!("untouched", std::fs::read_to_string(path.join("keep.txt")).unwrap());
    assert!(!f.repo.try_git(&["show-ref", "--verify", "refs/heads/task/race"]).status.success());
}

#[test]
fn changed_target_or_source_branch_requires_a_new_review() {
    let mut f = Fixture::new(); let tree = f.create("stale-target");
    let preview = f.service.preview_action(ActionInput { id: tree.id.clone(), action: Action::Merge,
        message: None, target_path: Some(f.repo.path().into()) }).unwrap();
    f.repo.write("new.txt", "target changed"); f.repo.commit();
    assert!(f.service.execute(&preview.token, |_| false).is_err());
    let output = std::process::Command::new("git").arg("-C").arg(&tree.root_path)
        .args(["checkout", "-b", "foreign-branch"]).output().unwrap();
    assert!(output.status.success());
    assert!(f.action(&tree, Action::Commit).is_err());
}
