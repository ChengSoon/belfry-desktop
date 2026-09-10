use super::*;
use crate::harness::broker::{ReadBroker, SessionRegistration};
use std::fs;

#[cfg(unix)]
#[test]
fn symlink_swap_after_preview_cannot_write_outside_root() {
    use std::os::unix::fs::symlink;
    let root = std::env::temp_dir().join(format!("belfry-patch-race-{}", ulid::Ulid::generate()));
    fs::create_dir(&root).unwrap();
    fs::write(root.join("file.txt"), "old\n").unwrap();
    let outside = root
        .parent()
        .unwrap()
        .join(format!("outside-{}", ulid::Ulid::generate()));
    fs::write(&outside, "old\n").unwrap();
    let sessions = ReadBroker::new(|_| {});
    sessions
        .register(SessionRegistration {
            session_id: "s".into(),
            worker_id: "w".into(),
            project_root: root.to_string_lossy().into(),
            harness_id: "h".into(),
            harness_version: "1".into(),
            declared_tools: vec!["project.patch.propose".into(), "project.patch.apply".into()],
            granted_capabilities: vec!["project.write".into()],
        })
        .unwrap();
    let patches = PatchBroker::new(|_| {});
    let preview = patches
        .propose(
            &sessions,
            ProposeRequest {
                session_id: "s".into(),
                worker_id: "w".into(),
                request_id: "r".into(),
                tool_id: "t".into(),
                relative_path: "file.txt".into(),
                expected_digest: digest("old\n"),
                replacement: "owned".into(),
            },
        )
        .unwrap();
    let token = patches.approve(&preview.preview_id).unwrap();
    fs::remove_file(root.join("file.txt")).unwrap();
    symlink(&outside, root.join("file.txt")).unwrap();
    let error = patches
        .apply(
            &sessions,
            ApplyRequest {
                session_id: "s".into(),
                worker_id: "w".into(),
                request_id: "a".into(),
                tool_id: "at".into(),
                preview_id: preview.preview_id,
                approval_token: token,
            },
        )
        .unwrap_err();
    assert_eq!(error.code, "PATH_OUTSIDE_ROOT");
    assert_eq!(fs::read_to_string(&outside).unwrap(), "old\n");
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_file(outside);
}
