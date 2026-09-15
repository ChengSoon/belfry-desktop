use super::contracts::{DiffRequest, DiffStage};
use super::fixtures::Repository;
use super::{diff, status};

#[test]
fn reports_unmerged_files_and_keeps_the_combined_diff_readable() {
    let repo = Repository::new();
    repo.write("conflict.txt", "base\n");
    repo.commit();
    repo.git(&["checkout", "-b", "other"]);
    repo.write("conflict.txt", "other\n");
    repo.commit();
    repo.git(&["checkout", "main"]);
    repo.write("conflict.txt", "main\n");
    repo.commit();
    assert!(!repo.try_git(&["merge", "other"]).status.success());
    let report = status::read(repo.path()).unwrap();
    assert_eq!(1, report.entries.len());
    assert!(report.entries[0].conflicted);
    let patch = diff::read(DiffRequest {
        root_path: repo.path().into(),
        path: "conflict.txt".into(),
        stage: DiffStage::Unstaged,
    })
    .unwrap();
    assert!(patch.text.contains("@@@"));
    assert!(patch.text.contains("<<<<<<<"));
}

#[test]
fn reports_staged_unstaged_deleted_and_untracked_unicode_paths() {
    let repo = Repository::new();
    repo.write("文件 空格.txt", "original\n");
    repo.write("删除.txt", "delete me\n");
    repo.commit();
    repo.write("文件 空格.txt", "staged\n");
    repo.git(&["add", "文件 空格.txt"]);
    repo.write("文件 空格.txt", "working\n");
    std::fs::remove_file(repo.root.join("删除.txt")).unwrap();
    repo.write("新的文件.txt", "new file\n");
    let report = status::read(repo.path()).unwrap();
    assert_eq!(Some("main"), report.branch.as_deref());
    assert_eq!(3, report.entries.len());
    let edited = report
        .entries
        .iter()
        .find(|entry| entry.path == "文件 空格.txt")
        .unwrap();
    assert_eq!("M", edited.index_status);
    assert_eq!("M", edited.worktree_status);
    assert!(report
        .entries
        .iter()
        .any(|entry| entry.path == "删除.txt" && entry.worktree_status == "D"));
    assert!(report
        .entries
        .iter()
        .any(|entry| entry.path == "新的文件.txt" && entry.untracked));
}

#[test]
fn staged_rename_preserves_both_paths_and_returns_the_rename_diff() {
    let repo = Repository::new();
    repo.write("旧 文件.txt", "line one\nline two\n");
    repo.commit();
    repo.git(&["mv", "旧 文件.txt", "新 文件.txt"]);
    let report = status::read(repo.path()).unwrap();
    let entry = &report.entries[0];
    assert_eq!("新 文件.txt", entry.path);
    assert_eq!(Some("旧 文件.txt"), entry.original_path.as_deref());
    let request = DiffRequest {
        root_path: repo.path().into(),
        path: entry.path.clone(),
        stage: DiffStage::Staged,
    };
    let patch = diff::read(request).unwrap();
    assert!(patch.text.contains("rename from"));
    assert!(patch.text.contains("rename to"));
}

#[test]
fn diff_reading_keeps_index_head_and_working_tree_unchanged() {
    let repo = Repository::new();
    repo.write("a.txt", "original\n");
    repo.commit();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "working\n");
    let index = repo.git(&["hash-object", "--no-filters", ".git/index"]);
    let head = repo.git(&["rev-parse", "HEAD"]);
    let before = std::fs::read(repo.root.join("a.txt")).unwrap();
    for stage in [DiffStage::Staged, DiffStage::Unstaged] {
        let patch = diff::read(DiffRequest {
            root_path: repo.path().into(),
            path: "a.txt".into(),
            stage,
        })
        .unwrap();
        assert!(patch.text.contains("@@"));
    }
    status::read(repo.path()).unwrap();
    assert_eq!(
        index,
        repo.git(&["hash-object", "--no-filters", ".git/index"])
    );
    assert_eq!(head, repo.git(&["rev-parse", "HEAD"]));
    assert_eq!(before, std::fs::read(repo.root.join("a.txt")).unwrap());
}

#[test]
fn supports_unborn_branches_and_reports_non_git_directories() {
    let repo = Repository::new();
    repo.write("new.txt", "first\n");
    let report = status::read(repo.path()).unwrap();
    assert!(report.repository);
    assert_eq!(Some("main"), report.branch.as_deref());
    assert_eq!(None, report.head);
    let plain = std::env::temp_dir();
    assert!(!status::read(plain.to_str().unwrap()).unwrap().repository);
}

#[test]
fn reads_new_text_and_binary_files_and_rejects_path_escape() {
    let repo = Repository::new();
    repo.write("新建.txt", "new\n");
    repo.write("image.bin", [0_u8, 1, 2, 0]);
    let request = |path: &str| DiffRequest {
        root_path: repo.path().into(),
        path: path.into(),
        stage: DiffStage::Untracked,
    };
    let patch = diff::read(request("新建.txt")).unwrap();
    assert!(patch.text.contains("+new"));
    assert!(!patch.binary);
    assert!(diff::read(request("image.bin")).unwrap().binary);
    assert!(diff::read(request("../outside.txt")).is_err());
}
