use super::{
    protocol::{Command, PollResult, WireOverlay},
    service::Service,
};
use crate::terminal::{CreateTerminalRequest, TerminalEvent};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

struct Fixture {
    root: PathBuf,
    service: Arc<Service>,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("belfry-daemon-qa-{}", ulid::Ulid::generate()));
        std::fs::create_dir_all(&root).unwrap();
        let service = Service::new(root.clone()).unwrap();
        Self { root, service }
    }
    fn request(&self, tab: &str) -> CreateTerminalRequest {
        serde_json::from_value(serde_json::json!({ "platform": "macos", "profileId": "shell:bash", "tabId": tab,
            "cwd": crate::resource::path_to_file_uri(&self.root), "cols": 80, "rows": 24, "elevation": "normal" })).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.service.handle(Command::Shutdown);
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn a_saved_attachment_and_duplicate_create_keep_the_original_pty() {
    let fixture = Fixture::new();
    let first = fixture
        .service
        .create(fixture.request("tab"), WireOverlay::default(), None)
        .unwrap();
    let duplicate = fixture
        .service
        .create(fixture.request("tab"), WireOverlay::default(), None)
        .unwrap();
    let attached = fixture
        .service
        .create(
            fixture.request("tab"),
            WireOverlay::default(),
            Some(first.id.clone()),
        )
        .unwrap();
    assert_eq!(first.id, duplicate.id);
    assert_eq!(first.id, attached.id);
    assert!(!first.reconnected);
    assert!(attached.reconnected);
    assert!(duplicate.reconnected);
    assert_eq!(1, fixture.service.list().len());
    assert!(
        fixture
            .service
            .create(
                fixture.request("other"),
                WireOverlay::default(),
                Some(first.id.clone())
            )
            .is_err()
    );
    assert!(
        fixture
            .service
            .create(
                fixture.request("tab"),
                WireOverlay::default(),
                Some("missing".into())
            )
            .is_err()
    );
    assert_eq!(1, fixture.service.list().len());
}

#[test]
fn output_survives_without_a_consumer_and_replays_in_order() {
    let fixture = Fixture::new();
    let session = fixture
        .service
        .create(fixture.request("tab"), WireOverlay::default(), None)
        .unwrap();
    assert!(
        fixture
            .service
            .handle(Command::Write {
                id: session.id.clone(),
                bytes: "printf '后台中文输出\\n'\r".as_bytes().to_vec()
            })
            .error
            .is_none()
    );
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut cursor = 0;
    let mut output = vec![];
    let mut sequences = vec![];
    while Instant::now() < deadline {
        let response = fixture.service.handle(Command::Poll {
            id: session.id.clone(),
            cursor,
        });
        let page: PollResult = serde_json::from_value(response.result.unwrap()).unwrap();
        cursor = page.cursor;
        for frame in page.frames {
            if let TerminalEvent::Output {
                sequence, bytes, ..
            } = frame.event
            {
                output.extend(bytes);
                sequences.push(sequence);
            }
        }
        if String::from_utf8_lossy(&output).contains("后台中文输出") {
            break;
        }
    }
    assert!(String::from_utf8_lossy(&output).contains("后台中文输出"));
    assert_eq!((0..sequences.len() as u64).collect::<Vec<_>>(), sequences);
    let replay: PollResult = serde_json::from_value(
        fixture
            .service
            .handle(Command::Poll {
                id: session.id,
                cursor: 0,
            })
            .result
            .unwrap(),
    )
    .unwrap();
    assert!(replay.frames.len() >= sequences.len());
}

#[test]
fn closed_tabs_remain_occupied_until_the_native_process_exits() {
    let fixture = Fixture::new();
    let old = fixture
        .service
        .create(fixture.request("tab"), WireOverlay::default(), None)
        .unwrap();
    assert!(
        fixture
            .service
            .handle(Command::CloseTab {
                tab_id: "tab".into()
            })
            .error
            .is_none()
    );
    let fresh = fixture
        .service
        .create(fixture.request("tab"), WireOverlay::default(), None)
        .unwrap();
    assert_ne!(old.id, fresh.id);
    assert!(!fresh.reconnected);
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        if !fixture.service.list().iter().any(|item| {
            item.session.id == old.id
                && item.session.status == super::super::contracts::TerminalStatus::Running
        }) {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        !fixture
            .service
            .list()
            .iter()
            .any(|item| item.session.id == old.id
                && item.session.status == super::super::contracts::TerminalStatus::Running)
    );
    assert!(fixture.service.handle(Command::Shutdown).error.is_none());
    assert!(
        fixture
            .service
            .create(fixture.request("later"), WireOverlay::default(), None)
            .is_err()
    );
}

#[test]
fn private_overlay_copies_live_past_the_ui_owned_snapshot() {
    let fixture = Fixture::new();
    let original =
        crate::terminal::overlay::LaunchFile::create(&fixture.root.join("ui"), "{\"qa\":true}")
            .unwrap();
    let old = original.path().to_string_lossy().into_owned();
    let overlay = crate::terminal::overlay::LaunchOverlay {
        arguments: vec![old.clone()],
        environment: HashMap::from([("QA_PATH".into(), old.clone())]),
        retained_files: vec![original.clone()],
        ..Default::default()
    };
    let wire = super::files::encode(&overlay).unwrap();
    let copied = super::files::decode(wire, &fixture.root.join("daemon")).unwrap();
    drop(overlay);
    drop(original);
    assert!(!std::path::Path::new(&old).exists());
    assert_eq!(
        "{\"qa\":true}",
        std::fs::read_to_string(&copied.arguments[0]).unwrap()
    );
    assert_eq!(copied.arguments[0], copied.environment["QA_PATH"]);
}

#[test]
fn worktree_execution_holds_new_spawns_but_can_reconnect_existing_sessions() {
    let fixture = Fixture::new();
    let session = fixture
        .service
        .create(fixture.request("old"), WireOverlay::default(), None)
        .unwrap();
    let token: String = serde_json::from_value(
        fixture
            .service
            .handle(Command::AcquireWorkspace)
            .result
            .unwrap(),
    )
    .unwrap();
    assert!(
        fixture
            .service
            .create(fixture.request("new"), WireOverlay::default(), None)
            .is_err()
    );
    let attached = fixture
        .service
        .create(
            fixture.request("old"),
            WireOverlay::default(),
            Some(session.id.clone()),
        )
        .unwrap();
    assert_eq!(session.id, attached.id);
    fixture.service.handle(Command::ReleaseWorkspace { token });
    assert!(
        fixture
            .service
            .create(fixture.request("new"), WireOverlay::default(), None)
            .is_ok()
    );
}
