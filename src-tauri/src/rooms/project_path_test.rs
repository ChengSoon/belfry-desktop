use std::fs;
use std::path::{Path, PathBuf};

use super::{RoomStore, model::new_id};
use crate::resource::canonicalize;

struct Fixture {
    root: PathBuf,
    project: PathBuf,
    store: RoomStore,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-room-project-{}", new_id()));
        let project = root.join("项目 with spaces");
        fs::create_dir_all(&project).unwrap();
        let store = RoomStore::load(Some(root.join("rooms")));
        Self {
            root,
            project,
            store,
        }
    }

    fn assert_rejected(&self, requested: &str, code: &str, message: &str) {
        for locale in [belfry_i18n::Locale::ZhCn, belfry_i18n::Locale::En] {
            belfry_i18n::with_locale(locale, || {
                let error = self.store.create("Room", requested, "").unwrap_err();
                let wire = serde_json::to_value(error).unwrap();
                assert_eq!(wire["code"], code);
                assert_eq!(
                    wire["params"],
                    serde_json::json!({ "path": requested.trim() })
                );
                assert_eq!(wire["message"], format!("{message}: {}", requested.trim()));
                assert_eq!(wire["retryable"], false);
                assert!(self.store.list().unwrap().rooms.is_empty());
                assert!(!self.root.join("rooms/rooms.json").exists());
            });
        }
    }

    fn assert_canonical(&self, requested: &str, expected: &Path) {
        let room = self.store.create("Room", requested, "").unwrap();
        let expected = canonicalize(expected).unwrap();
        assert_eq!(Path::new(&room.project_root), expected);
        assert!(Path::new(&room.project_root).is_absolute());
        let reloaded = RoomStore::load(Some(self.root.join("rooms")));
        assert_eq!(
            reloaded.get(&room.id).unwrap().project_root,
            room.project_root
        );
        assert_eq!(
            reloaded.list().unwrap().rooms[0].project_root,
            room.project_root
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn regression_room_project_missing_path_is_rejected_without_persisting_a_room() {
    let fixture = Fixture::new();
    let missing = fixture.root.join("missing 项目");
    fixture.assert_rejected(
        &format!("  {}  ", missing.display()),
        "ROOM_PROJECT_NOT_FOUND",
        "Room project directory was not found",
    );
}

#[test]
fn regression_room_project_file_path_is_rejected_without_persisting_a_room() {
    let fixture = Fixture::new();
    let file = fixture.project.join("notes.txt");
    fs::write(&file, "a file, not a project directory").unwrap();
    fixture.assert_rejected(
        file.to_str().unwrap(),
        "ROOM_PROJECT_NOT_DIRECTORY",
        "Room project path must point to a directory",
    );
}

#[test]
fn regression_room_project_relative_path_is_saved_as_an_absolute_directory() {
    let fixture = Fixture::new();
    fixture.assert_canonical("  .  ", &std::env::current_dir().unwrap());
}

#[test]
fn regression_room_project_parent_components_are_resolved_before_persisting() {
    let fixture = Fixture::new();
    let child = fixture.project.join("child");
    fs::create_dir(&child).unwrap();
    fixture.assert_canonical(child.join("..").to_str().unwrap(), &fixture.project);
}

#[cfg(unix)]
#[test]
fn regression_room_project_symlink_is_saved_as_its_target_directory() {
    let fixture = Fixture::new();
    let link = fixture.root.join("project link");
    std::os::unix::fs::symlink(&fixture.project, &link).unwrap();
    fixture.assert_canonical(link.to_str().unwrap(), &fixture.project);
}

#[test]
fn empty_room_project_keeps_the_existing_required_field_error() {
    let fixture = Fixture::new();
    for input in ["", " \t\n "] {
        let error = fixture.store.create("Room", input, "").unwrap_err();
        assert_eq!(error.code.0, "ROOM_A_ROOM_MUST_BELONG_TO_A_PROJECT");
        assert!(fixture.store.list().unwrap().rooms.is_empty());
    }
}

#[test]
fn loading_and_creating_rooms_preserves_existing_project_paths_verbatim() {
    let fixture = Fixture::new();
    let room = fixture
        .store
        .create("Existing", fixture.project.to_str().unwrap(), "")
        .unwrap();
    let path = fixture.root.join("rooms/rooms.json");
    let mut snapshot: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let legacy_path = "old-project/../missing-project";
    snapshot["rooms"][0]["projectRoot"] = serde_json::json!(legacy_path);
    fs::write(&path, serde_json::to_vec(&snapshot).unwrap()).unwrap();

    let reloaded = RoomStore::load(Some(fixture.root.join("rooms")));
    assert!(reloaded.list().unwrap().load_error.is_none());
    assert_eq!(reloaded.get(&room.id).unwrap().project_root, legacy_path);
    reloaded
        .create("New", fixture.project.to_str().unwrap(), "")
        .unwrap();
    let persisted = RoomStore::load(Some(fixture.root.join("rooms")));
    assert_eq!(persisted.get(&room.id).unwrap().project_root, legacy_path);
}
