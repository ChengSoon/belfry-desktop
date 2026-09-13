use super::contracts::{DiffRequest, DiffStage};
use super::fixtures::Repository;
use super::{diff, status};

fn request(repo: &Repository, path: &str) -> DiffRequest {
    DiffRequest {
        root_path: repo.path().into(),
        path: path.into(),
        stage: DiffStage::Unstaged,
    }
}

#[test]
fn supports_subdirectories_and_separate_worktrees() {
    let repo = Repository::new();
    repo.write("nested/a.txt", "initial\n");
    repo.commit();
    let nested = repo.root.join("nested");
    assert_eq!(
        crate::resource::canonicalize(&repo.root)
            .unwrap()
            .to_str()
            .unwrap(),
        status::read(nested.to_str().unwrap()).unwrap().root_path
    );
    let tree = repo.root.join("task");
    repo.git(&["worktree", "add", "-b", "task-a", tree.to_str().unwrap()]);
    std::fs::write(tree.join("nested/a.txt"), "task only\n").unwrap();
    let report = status::read(tree.to_str().unwrap()).unwrap();
    assert_eq!(Some("task-a"), report.branch.as_deref());
    assert_eq!("nested/a.txt", report.entries[0].path);
    assert!(String::from_utf8(repo.git(&["show", "HEAD:nested/a.txt"]))
        .unwrap()
        .contains("initial"));
}

#[test]
fn pathspec_characters_are_treated_as_literal_file_names() {
    let repo = Repository::new();
    repo.write("[a].txt", "initial\n");
    repo.write("a.txt", "initial\n");
    repo.commit();
    repo.write("[a].txt", "literal target\n");
    repo.write("a.txt", "other file\n");
    let patch = diff::read(request(&repo, "[a].txt")).unwrap();
    assert!(patch.text.contains("+literal target"));
    assert!(!patch.text.contains("+other file"));
}

#[test]
fn reports_large_diff_truncation_without_returning_unbounded_text() {
    let repo = Repository::new();
    repo.write("large.txt", "initial\n");
    repo.commit();
    repo.write("large.txt", "中文内容\n".repeat(100_000));
    let patch = diff::read(request(&repo, "large.txt")).unwrap();
    assert!(patch.truncated);
    assert!(patch.text.len() <= 512 * 1024);
    assert!(patch.text.is_char_boundary(patch.text.len()));
}

#[test]
fn staged_deletion_and_new_file_at_the_same_path_have_separate_diffs() {
    let repo = Repository::new();
    repo.write("a.txt", "old\n");
    repo.commit();
    repo.git(&["rm", "a.txt"]);
    repo.write("a.txt", "replacement\n");
    let mut input = request(&repo, "a.txt");
    input.stage = DiffStage::Untracked;
    assert!(diff::read(input).unwrap().text.contains("+replacement"));
    let mut input = request(&repo, "a.txt");
    input.stage = DiffStage::Staged;
    assert!(diff::read(input).unwrap().text.contains("-old"));
}

#[cfg(unix)]
#[test]
fn repository_diff_and_fsmonitor_helpers_are_never_executed() {
    use std::os::unix::fs::PermissionsExt;
    let repo = Repository::new();
    let marker = repo.root.join("helper-was-executed");
    let helper = repo.root.join("helper.sh");
    repo.write(
        "helper.sh",
        format!("#!/bin/sh\ntouch '{}'\nexit 93\n", marker.display()),
    );
    std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700)).unwrap();
    repo.write(".gitattributes", "*.txt diff=unsafe\n");
    repo.write("a.txt", "initial\n");
    repo.commit();
    repo.git(&["config", "diff.external", helper.to_str().unwrap()]);
    repo.git(&["config", "diff.unsafe.textconv", helper.to_str().unwrap()]);
    repo.git(&["config", "core.fsmonitor", helper.to_str().unwrap()]);
    repo.write("a.txt", "safe read\n");
    assert!(diff::read(request(&repo, "a.txt"))
        .unwrap()
        .text
        .contains("+safe read"));
    assert!(!marker.exists());
}

#[cfg(unix)]
#[test]
fn untracked_symlinks_cannot_read_content_outside_the_repository() {
    let repo = Repository::new();
    std::os::unix::fs::symlink("/etc/hosts", repo.root.join("external")).unwrap();
    let mut input = request(&repo, "external");
    input.stage = DiffStage::Untracked;
    assert!(diff::read(input).is_err());
}
