use super::*;
use std::sync::Arc;

use belfry_protocol::{Command, ResponseData};

use crate::collab::{RoomDirectory, SessionRegistry};
use crate::rooms::directory::MemberDirectory;
use crate::rooms::model::{now_millis, Actor, Room};
use crate::rooms::ops;
use crate::rooms::store::deliveries;

struct Fixture {
    root: PathBuf,
    store: Arc<RoomStore>,
    room: Room,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-room-attachments-{}", new_id()));
        let store = Arc::new(RoomStore::load(Some(root.join("rooms"))));
        let room = store.create("附件测试", "/synthetic/project", "").unwrap();
        store.mutate(&room.id, |room| crate::rooms::test_support::add(room, "tab-1", "设计", "")).unwrap();
        let room = store.get(&room.id).unwrap();
        Self { root, store, room }
    }

    fn send(&self, text: &str, files: Vec<RoomAttachment>) -> Result<(String, Room), AppError> {
        self.store
            .mutate(&self.room.id, |room| {
                validate_existing(&files).map_err(|err| err.message)?;
                ops::say_with(room, &Actor::User, &[], text, None, false, files.clone(), now_millis())
                    .map(|posted| posted.message_id)
            })
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
    assert_eq!(fs::read(&first.path).unwrap(), b"%PDF-1.7 synthetic document");
    assert_eq!(fs::read(&second.path).unwrap(), b"changed document");
    assert_eq!(resolve(&fixture.store, &fixture.room.id, &[first.id.clone()]).unwrap(), vec![first]);
}

#[test]
fn attachment_only_messages_survive_reload_and_reach_members_with_readable_paths() {
    let fixture = Fixture::new();
    let attachment = import_bytes(&fixture.store, &fixture.room.id, "设计.png", b"synthetic image").unwrap();
    let (message_id, room) = fixture.send("", vec![attachment.clone()]).unwrap();

    // 发进成员终端的那一行带着附件的本地路径。
    let posted = ops::Posted { message_id: message_id.clone(), to: room.message(&message_id).unwrap().to.clone() };
    let line = &deliveries(&room, &[posted])[0].line;
    assert!(line.contains(&attachment.path) && line.contains("设计.png"), "{line}");

    let reloaded = Arc::new(RoomStore::load(Some(fixture.root.join("rooms"))));
    let message = reloaded.get(&room.id).unwrap().message(&message_id).unwrap().clone();
    assert_eq!(message.text, "");
    assert_eq!(message.attachments, vec![attachment.clone()]);

    // 成员读 log 也看得到路径。
    let directory = MemberDirectory { store: reloaded.clone(), registry: Arc::new(SessionRegistry::default()) };
    let (data, _) = directory.handle("tab-1", &Command::RoomLog { room: None, count: None }).unwrap();
    let ResponseData::RoomLog { entries, .. } = data else { panic!("not a log") };
    assert!(entries.last().unwrap().text.contains(&attachment.path));

    reloaded.discard_attachment(&room.id, &attachment.id).unwrap();
    assert!(Path::new(&attachment.path).is_file(), "迟到的草稿清理不能删掉已发送的文件");
    let ledger = fs::read_to_string(fixture.root.join("rooms/ledgers").join(format!("{}.jsonl", room.id))).unwrap();
    assert!(!ledger.contains("synthetic image"), "二进制不进账本");
    assert!(!fs::read_to_string(fixture.root.join("rooms/rooms.json")).unwrap().contains("synthetic image"));
}

#[test]
fn attachments_cannot_cross_rooms_and_discard_only_removes_the_requested_draft() {
    let fixture = Fixture::new();
    let other = fixture.store.create("另一间房", "/synthetic/project", "").unwrap();
    let first = import_bytes(&fixture.store, &fixture.room.id, "a.txt", b"a").unwrap();
    let second = import_bytes(&fixture.store, &fixture.room.id, "b.txt", b"b").unwrap();
    assert!(resolve(&fixture.store, &other.id, &[first.id.clone()]).is_err());
    assert!(resolve(&fixture.store, &fixture.room.id, &["../rooms.json".into()]).is_err());
    fixture.store.discard_attachment(&fixture.room.id, &first.id).unwrap();
    assert!(!Path::new(&first.path).exists());
    assert!(Path::new(&second.path).is_file());
    fixture.store.discard_attachment(&fixture.room.id, &first.id).unwrap();
}

#[test]
fn enforces_size_count_duplicate_and_regular_file_limits() {
    let fixture = Fixture::new();
    let source = fixture.root.join("large.pdf");
    File::create(&source).unwrap().set_len(MAX_ATTACHMENT_BYTES + 1).unwrap();
    assert!(import_path(&fixture.store, &fixture.room.id, source.to_str().unwrap()).unwrap_err().message.contains("20 MB"));
    assert!(import_bytes(&fixture.store, &fixture.room.id, "large.png", &vec![0; MAX_ATTACHMENT_BYTES as usize + 1]).is_err());
    assert!(import_path(&fixture.store, &fixture.room.id, fixture.root.to_str().unwrap()).unwrap_err().message.contains("文件夹"));
    let attachment = import_bytes(&fixture.store, &fixture.room.id, "small.md", b"hello").unwrap();
    assert!(resolve(&fixture.store, &fixture.room.id, &vec![attachment.id.clone(); MAX_ATTACHMENTS + 1])
        .unwrap_err().message.contains("10"));
    assert!(resolve(&fixture.store, &fixture.room.id, &[attachment.id.clone(), attachment.id])
        .unwrap_err().message.contains("两次"));
}

#[test]
fn sanitizes_pasted_names_without_overwriting_metadata_or_escaping_storage() {
    let fixture = Fixture::new();
    for name in ["../../rooms.json", "C:\\notes\\metadata.json", "CON.txt", "\n需求\r\n.png"] {
        let attachment = import_bytes(&fixture.store, &fixture.room.id, name, b"content").unwrap();
        assert!(Path::new(&attachment.path).starts_with(canonicalize(&fixture.root).unwrap()));
        assert!(!attachment.name.chars().any(char::is_control));
        assert!(!attachment.name.contains(['/', '\\']));
        assert_eq!(resolve(&fixture.store, &fixture.room.id, &[attachment.id.clone()]).unwrap(), vec![attachment]);
    }
    assert!(fixture.store.get(&fixture.room.id).is_ok());
}

#[test]
fn a_discarded_attachment_cannot_be_sent() {
    let fixture = Fixture::new();
    let attachment = import_bytes(&fixture.store, &fixture.room.id, "notes.txt", b"hello").unwrap();
    fixture.store.discard_attachment(&fixture.room.id, &attachment.id).unwrap();
    assert!(resolve(&fixture.store, &fixture.room.id, &[attachment.id.clone()]).is_err());
    let before = fixture.store.get(&fixture.room.id).unwrap().messages.len();
    assert!(fixture.send("读一下", vec![attachment]).is_err());
    assert_eq!(fixture.store.get(&fixture.room.id).unwrap().messages.len(), before);
}

#[test]
fn file_names_never_count_as_mentions_and_empty_messages_need_a_file() {
    let fixture = Fixture::new();
    fixture.store.mutate(&fixture.room.id, |room| crate::rooms::test_support::add(room, "tab-2", "后端", "")).unwrap();
    let attachment = import_bytes(&fixture.store, &fixture.room.id, "给@后端的说明.md", b"x").unwrap();
    let (message_id, room) = fixture.send("", vec![attachment]).unwrap();
    // 不写收件人、正文为空：发给统筹（第一位成员「设计」），不会因为文件名里的 @后端 改道。
    assert_eq!(room.message(&message_id).unwrap().to, vec![room.foreman().unwrap().id.clone()]);
    assert!(fixture.send("  ", Vec::new()).is_err());
}

#[test]
fn messages_without_attachments_keep_the_ledger_line_unchanged_and_reload() {
    let fixture = Fixture::new();
    fixture.send("以前的消息", Vec::new()).unwrap();
    let ledger = fs::read_to_string(fixture.root.join("rooms/ledgers").join(format!("{}.jsonl", fixture.room.id))).unwrap();
    assert!(!ledger.contains("\"attachments\""), "没有附件时不写这个字段，旧版本读得懂");
    let room = RoomStore::load(Some(fixture.root.join("rooms"))).get(&fixture.room.id).unwrap();
    assert_eq!(room.messages.last().unwrap().text, "以前的消息");
    assert!(room.messages.last().unwrap().attachments.is_empty());
}

#[test]
fn deleting_a_room_removes_its_attachments() {
    let fixture = Fixture::new();
    let attachment = import_bytes(&fixture.store, &fixture.room.id, "a.txt", b"a").unwrap();
    fixture.store.delete(&fixture.room.id).unwrap();
    assert!(!Path::new(&attachment.path).exists());
}

#[test]
fn a_quote_of_an_attachment_only_message_names_the_files() {
    assert_eq!(summary("", &[]), "");
    let file = RoomAttachment { id: new_id(), name: "需求.pdf".into(), path: "/x/需求.pdf".into(), size: 1, mime_type: "application/pdf".into() };
    assert_eq!(summary("", std::slice::from_ref(&file)), "[附件] 需求.pdf");
    assert_eq!(summary("看下", &[file]), "看下");
}
