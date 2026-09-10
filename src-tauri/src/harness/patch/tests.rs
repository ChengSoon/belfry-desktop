use super::*;
use crate::harness::broker::{ReadBroker, SessionRegistration};
use std::{
    fs,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread,
};

struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-patch-{}", ulid::Ulid::generate()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("file.txt"), "old\n").unwrap();
        Self { root }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn setup() -> (
    Arc<ReadBroker>,
    Arc<PatchBroker>,
    Arc<Mutex<Vec<PatchAudit>>>,
    Fixture,
) {
    let fixture = Fixture::new();
    let sessions = Arc::new(ReadBroker::new(|_| {}));
    sessions
        .register(SessionRegistration {
            session_id: "s".into(),
            worker_id: "w".into(),
            project_root: fixture.root.to_string_lossy().into(),
            harness_id: "h".into(),
            harness_version: "1".into(),
            declared_tools: vec!["project.patch.propose".into(), "project.patch.apply".into()],
            granted_capabilities: vec!["project.write".into()],
        })
        .unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let patches = Arc::new(PatchBroker::new(move |event| {
        captured.lock().unwrap().push(event)
    }));
    (sessions, patches, events, fixture)
}

fn propose(replacement: &str) -> ProposeRequest {
    ProposeRequest {
        session_id: "s".into(),
        worker_id: "w".into(),
        request_id: "r".into(),
        tool_id: "t".into(),
        relative_path: "file.txt".into(),
        expected_digest: digest("old\n"),
        replacement: replacement.into(),
    }
}
fn apply(preview: &PatchPreview, token: String) -> ApplyRequest {
    ApplyRequest {
        session_id: "s".into(),
        worker_id: "w".into(),
        request_id: "a".into(),
        tool_id: "at".into(),
        preview_id: preview.preview_id.clone(),
        approval_token: token,
    }
}

#[test]
fn propose_is_zero_write_and_approved_apply_is_one_time() {
    let (sessions, patches, events, fixture) = setup();
    let preview = patches.propose(&sessions, propose("new\n")).unwrap();
    assert_eq!(
        fs::read_to_string(fixture.root.join("file.txt")).unwrap(),
        "old\n"
    );
    let token = patches.approve(&preview.preview_id).unwrap();
    patches
        .apply(&sessions, apply(&preview, token.clone()))
        .unwrap();
    assert_eq!(
        fs::read_to_string(fixture.root.join("file.txt")).unwrap(),
        "new\n"
    );
    assert_eq!(
        patches
            .apply(&sessions, apply(&preview, token))
            .unwrap_err()
            .code,
        "PREVIEW_EXPIRED"
    );
    assert!(
        events
            .lock()
            .unwrap()
            .iter()
            .all(|event| !event.summary.contains("new"))
    );
    let phases: Vec<_> = events
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.phase)
        .collect();
    assert_eq!(
        phases,
        [
            "patch.proposed",
            "approval.required",
            "tool.started",
            "tool.completed",
            "tool.started",
            "tool.failed"
        ]
    );
}

#[test]
fn preview_hunks_are_host_computed_with_line_numbers_and_safe_text() {
    let (sessions, patches, _, fixture) = setup();
    fs::write(fixture.root.join("file.txt"), "one\r\ntwo\r\nthree\r\n").unwrap();
    let replacement = "one\r\nT\u{202e}WO\r\nthree\r\nfour\r\n";
    let mut request = propose(replacement);
    request.expected_digest = digest("one\r\ntwo\r\nthree\r\n");
    let preview = patches.propose(&sessions, request).unwrap();
    assert_eq!((preview.old_lines, preview.new_lines), (3, 4));
    assert_eq!(preview.final_bytes, replacement.len());
    assert!(!preview.diff.truncated);
    let lines = &preview.diff.hunks[0].lines;
    assert!(
        lines
            .iter()
            .any(|line| matches!(line.kind, DiffLineKind::Delete) && line.old_line == Some(2))
    );
    assert!(
        lines
            .iter()
            .any(|line| matches!(line.kind, DiffLineKind::Add)
                && line.new_line == Some(2)
                && line.content == "T\\u{202e}WO")
    );
}

#[test]
fn preview_is_bounded_but_apply_uses_the_complete_replacement() {
    let (sessions, patches, _, fixture) = setup();
    let replacement = (0..500)
        .map(|i| format!("changed-{i}-{}\n", "x".repeat(300)))
        .collect::<String>();
    let preview = patches.propose(&sessions, propose(&replacement)).unwrap();
    assert!(preview.diff.truncated);
    assert!(preview.diff.hunks.len() <= 32);
    assert!(
        preview
            .diff
            .hunks
            .iter()
            .all(|hunk| hunk.lines.len() <= 200)
    );
    assert!(preview.diff.preview_bytes <= 64 * 1024);
    let token = patches.approve(&preview.preview_id).unwrap();
    patches.apply(&sessions, apply(&preview, token)).unwrap();
    assert_eq!(
        fs::read_to_string(fixture.root.join("file.txt")).unwrap(),
        replacement
    );
}

#[test]
fn empty_and_trailing_newline_counts_are_stable() {
    let (sessions, patches, _, fixture) = setup();
    fs::write(fixture.root.join("file.txt"), "").unwrap();
    let mut request = propose("one\n");
    request.expected_digest = digest("");
    let preview = patches.propose(&sessions, request).unwrap();
    assert_eq!((preview.old_lines, preview.new_lines), (0, 1));
    assert_eq!(preview.diff.hunks[0].lines[0].new_line, Some(1));
}

#[test]
fn rejection_and_wrong_token_consume_preview() {
    let (sessions, patches, _, _fixture) = setup();
    let rejected = patches.propose(&sessions, propose("rejected")).unwrap();
    patches.reject(&rejected.preview_id).unwrap();
    assert_eq!(
        patches.approve(&rejected.preview_id).unwrap_err().code,
        "PREVIEW_EXPIRED"
    );
    let preview = patches.propose(&sessions, propose("new")).unwrap();
    let _ = patches.approve(&preview.preview_id).unwrap();
    assert_eq!(
        patches
            .apply(&sessions, apply(&preview, "wrong".into()))
            .unwrap_err()
            .code,
        "APPROVAL_DENIED"
    );
    assert_eq!(
        patches.approve(&preview.preview_id).unwrap_err().code,
        "PREVIEW_EXPIRED"
    );
}

#[test]
fn revoke_cancel_and_content_change_block_apply() {
    let (sessions, patches, _, fixture) = setup();
    let preview = patches.propose(&sessions, propose("new")).unwrap();
    let token = patches.approve(&preview.preview_id).unwrap();
    sessions.update_grants("s", vec![]).unwrap();
    assert_eq!(
        patches
            .apply(&sessions, apply(&preview, token))
            .unwrap_err()
            .code,
        "CAPABILITY_DENIED"
    );
    sessions
        .update_grants("s", vec!["project.write".into()])
        .unwrap();
    let preview = patches.propose(&sessions, propose("newer")).unwrap();
    let token = patches.approve(&preview.preview_id).unwrap();
    fs::write(fixture.root.join("file.txt"), "changed").unwrap();
    assert_eq!(
        patches
            .apply(&sessions, apply(&preview, token))
            .unwrap_err()
            .code,
        "WRITE_CONFLICT"
    );
    sessions.cancel("s").unwrap();
    assert_eq!(
        patches
            .propose(&sessions, propose("later"))
            .unwrap_err()
            .code,
        "SESSION_CANCELLED"
    );
}

#[test]
fn rejects_binary_large_no_change_and_bad_path() {
    let (sessions, patches, _, fixture) = setup();
    assert_eq!(
        patches
            .propose(&sessions, propose("old\n"))
            .unwrap_err()
            .code,
        "NO_CHANGES"
    );
    fs::write(fixture.root.join("binary"), [0, 1]).unwrap();
    let mut binary = propose("x");
    binary.relative_path = "binary".into();
    binary.expected_digest = digest("ignored");
    assert_eq!(
        patches.propose(&sessions, binary).unwrap_err().code,
        "INVALID_PARAMS"
    );
    let mut bad = propose("x");
    bad.relative_path = "../outside".into();
    assert_eq!(
        patches.propose(&sessions, bad).unwrap_err().code,
        "PATH_OUTSIDE_ROOT"
    );
    let large = propose(&"x".repeat(512 * 1024 + 1));
    assert_eq!(
        patches.propose(&sessions, large.clone()).unwrap_err().code,
        "TOO_LARGE"
    );
}

#[test]
fn preview_store_is_bounded_and_expiring() {
    let fixture = Fixture::new();
    let sessions = ReadBroker::new(|_| {});
    sessions
        .register(SessionRegistration {
            session_id: "s".into(),
            worker_id: "w".into(),
            project_root: fixture.root.to_string_lossy().into(),
            harness_id: "h".into(),
            harness_version: "1".into(),
            declared_tools: vec!["project.patch.propose".into()],
            granted_capabilities: vec!["project.write".into()],
        })
        .unwrap();
    let now = Arc::new(AtomicU64::new(1));
    let clock = now.clone();
    let patches = PatchBroker::with_clock(|_| {}, move || clock.load(Ordering::SeqCst));
    let mut first = None;
    for index in 0..101 {
        let preview = patches
            .propose(&sessions, propose(&format!("new-{index}")))
            .unwrap();
        if first.is_none() {
            first = Some(preview.preview_id);
        }
    }
    assert_eq!(patches.preview_count(), 100);
    assert_eq!(
        patches.approve(&first.unwrap()).unwrap_err().code,
        "PREVIEW_EXPIRED"
    );
    now.store(TTL_MS + 2, Ordering::SeqCst);
    let latest = patches.propose(&sessions, propose("latest")).unwrap();
    now.store(TTL_MS * 2 + 3, Ordering::SeqCst);
    assert_eq!(
        patches.approve(&latest.preview_id).unwrap_err().code,
        "PREVIEW_EXPIRED"
    );
}

#[test]
fn same_path_concurrent_apply_has_one_winner_and_cleans_temps() {
    let (sessions, patches, _, fixture) = setup();
    let previews: Vec<_> = ["one", "two"]
        .iter()
        .map(|text| {
            let p = patches.propose(&sessions, propose(text)).unwrap();
            let t = patches.approve(&p.preview_id).unwrap();
            (p, t)
        })
        .collect();
    let handles: Vec<_> = previews
        .into_iter()
        .map(|(p, t)| {
            let s = sessions.clone();
            let b = patches.clone();
            thread::spawn(move || b.apply(&s, apply(&p, t)))
        })
        .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| result
                .as_ref()
                .is_err_and(|error| error.code == "WRITE_CONFLICT"))
            .count(),
        1
    );
    assert!(!fs::read_dir(&fixture.root).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("belfry-patch")
    }));
}
