use super::*;
use crate::rooms::store::{Room, RoomStore, new_id};

struct Fixture {
    root: PathBuf,
    store: RoomStore,
    room: Room,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-room-attachments-{}", new_id()));
        let store = RoomStore::load(Some(root.join("rooms.json")));
        let room = store.create("附件测试", "/synthetic/project").unwrap();
        Self { root, store, room }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn imports_a_document_copy_and_keeps_same_named_files_separate() {
    let fixture = Fixture::new();
    let source = fixture.root.join("需求 文档.pdf");
    fs::write(&source, b"%PDF-1.7 synthetic document").unwrap();
    let first = import_path(&fixture.store, &fixture.room.id, source.to_str().unwrap()).unwrap();
    fs::write(&source, b"changed document").unwrap();
    let second = import_path(&fixture.store, &fixture.room.id, source.to_str().unwrap()).unwrap();
    fs::remove_file(source).unwrap();
    assert_ne!(first.path, second.path);
    assert_eq!(first.name, "需求 文档.pdf");
    assert_eq!(first.mime_type, "application/pdf");
    assert_eq!(
        fs::read(&first.path).unwrap(),
        b"%PDF-1.7 synthetic document"
    );
    assert_eq!(fs::read(&second.path).unwrap(), b"changed document");
    assert_eq!(
        resolve(&fixture.store, &fixture.room.id, &[first.id.clone()]).unwrap(),
        vec![first]
    );
}

#[test]
fn attachment_only_messages_survive_reload_and_member_logs_include_readable_paths() {
    let fixture = Fixture::new();
    let room = fixture
        .store
        .add_member(&fixture.room.id, "tab-1", "claude", "设计", "")
        .unwrap();
    let attachment =
        import_bytes(&fixture.store, &room.id, "设计.png", b"synthetic image").unwrap();
    fixture
        .store
        .record_chat_with_attachments(
            &room.id,
            &new_id(),
            "",
            Vec::new(),
            None,
            vec![attachment.clone()],
        )
        .unwrap();
    let reloaded = RoomStore::load(Some(fixture.root.join("rooms.json")));
    let persisted = reloaded.get(&room.id).unwrap();
    let message = persisted.messages.last().unwrap();
    assert_eq!(message.text, "");
    assert_eq!(message.attachments, vec![attachment.clone()]);
    let log = reloaded.member_log("tab-1", None, 50).unwrap();
    assert!(log.lines.last().unwrap().text.contains(&attachment.path));
    reloaded
        .discard_attachment(&room.id, &attachment.id)
        .unwrap();
    assert!(
        Path::new(&attachment.path).is_file(),
        "迟到的草稿清理不能删掉已发送的文件"
    );
    let json = fs::read_to_string(fixture.root.join("rooms.json")).unwrap();
    assert!(!json.contains("synthetic image"), "二进制不进入消息存储");
}

#[test]
fn attachments_cannot_cross_rooms_and_discard_only_removes_the_requested_draft() {
    let fixture = Fixture::new();
    let other = fixture
        .store
        .create("另一间房", "/synthetic/project")
        .unwrap();
    let first = import_bytes(&fixture.store, &fixture.room.id, "a.txt", b"a").unwrap();
    let second = import_bytes(&fixture.store, &fixture.room.id, "b.txt", b"b").unwrap();
    assert!(resolve(&fixture.store, &other.id, &[first.id.clone()]).is_err());
    assert!(resolve(&fixture.store, &fixture.room.id, &["../rooms.json".into()]).is_err());
    fixture
        .store
        .discard_attachment(&fixture.room.id, &first.id)
        .unwrap();
    assert!(!Path::new(&first.path).exists());
    assert!(Path::new(&second.path).is_file());
    fixture
        .store
        .discard_attachment(&fixture.room.id, &first.id)
        .unwrap();
}

#[test]
fn enforces_size_count_duplicate_and_regular_file_limits() {
    let fixture = Fixture::new();
    let source = fixture.root.join("large.pdf");
    File::create(&source)
        .unwrap()
        .set_len(MAX_ATTACHMENT_BYTES + 1)
        .unwrap();
    assert!(
        import_path(&fixture.store, &fixture.room.id, source.to_str().unwrap())
            .unwrap_err()
            .message
            .contains("20 MB")
    );
    assert!(
        import_bytes(
            &fixture.store,
            &fixture.room.id,
            "large.png",
            &vec![0; MAX_ATTACHMENT_BYTES as usize + 1]
        )
        .is_err()
    );
    assert!(
        import_path(
            &fixture.store,
            &fixture.room.id,
            fixture.root.to_str().unwrap()
        )
        .unwrap_err()
        .message
        .contains("文件夹")
    );
    let attachment = import_bytes(&fixture.store, &fixture.room.id, "small.md", b"hello").unwrap();
    assert!(
        resolve(
            &fixture.store,
            &fixture.room.id,
            &vec![attachment.id.clone(); MAX_ATTACHMENTS + 1]
        )
        .unwrap_err()
        .message
        .contains("10")
    );
    assert!(
        resolve(
            &fixture.store,
            &fixture.room.id,
            &[attachment.id.clone(), attachment.id]
        )
        .unwrap_err()
        .message
        .contains("两次")
    );
}

#[test]
fn sanitizes_pasted_names_without_overwriting_metadata_or_escaping_storage() {
    let fixture = Fixture::new();
    for name in [
        "../../rooms.json",
        "C:\\notes\\metadata.json",
        "CON.txt",
        "\n需求\r\n.png",
    ] {
        let attachment = import_bytes(&fixture.store, &fixture.room.id, name, b"content").unwrap();
        assert!(Path::new(&attachment.path).starts_with(canonicalize(&fixture.root).unwrap()));
        assert!(!attachment.name.chars().any(char::is_control));
        assert!(!attachment.name.contains(['/', '\\']));
        assert_eq!(
            resolve(&fixture.store, &fixture.room.id, &[attachment.id.clone()]).unwrap(),
            vec![attachment]
        );
    }
    assert!(fixture.store.get(&fixture.room.id).is_ok());
}

#[test]
fn a_discarded_attachment_cannot_be_committed_or_dispatched() {
    let fixture = Fixture::new();
    let attachment = import_bytes(&fixture.store, &fixture.room.id, "notes.txt", b"hello").unwrap();
    fixture
        .store
        .discard_attachment(&fixture.room.id, &attachment.id)
        .unwrap();
    let before = fixture.store.get(&fixture.room.id).unwrap().messages.len();
    assert!(
        fixture
            .store
            .record_chat_with_attachments(
                &fixture.room.id,
                &new_id(),
                "读一下",
                Vec::new(),
                None,
                vec![attachment]
            )
            .is_err()
    );
    assert_eq!(
        fixture.store.get(&fixture.room.id).unwrap().messages.len(),
        before
    );
}

#[test]
fn older_messages_without_attachment_fields_still_load() {
    let fixture = Fixture::new();
    fixture
        .store
        .send_message(&fixture.room.id, "以前的消息", None)
        .unwrap();
    let path = fixture.root.join("rooms.json");
    let mut json: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for message in json["rooms"][0]["messages"].as_array_mut().unwrap() {
        message.as_object_mut().unwrap().remove("attachments");
    }
    fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
    let room = RoomStore::load(Some(path)).get(&fixture.room.id).unwrap();
    assert_eq!(room.messages.last().unwrap().text, "以前的消息");
    assert!(room.messages.last().unwrap().attachments.is_empty());
}
