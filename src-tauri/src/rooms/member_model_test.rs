use std::{fs, path::PathBuf};

use super::{RoomStore, member_model, model::{Member, Room, new_id}, ops};
use crate::agent::AgentKind;

struct Fixture {
    root: PathBuf,
    store: RoomStore,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("belfry-role-model-{}", new_id()));
        fs::create_dir_all(root.join("project")).unwrap();
        let store = RoomStore::load(Some(root.join("rooms")));
        Self { root, store }
    }

    fn room(&self, name: &str) -> Room {
        self.store.create(name, self.root.join("project").to_str().unwrap(), "").unwrap()
    }

    fn add(&self, room: &Room, tab: &str, title: &str) -> Member {
        let (id, updated) = self.store.mutate(&room.id, |room| {
            ops::add_member(room, tab, "codex", title, "", false, 1).map(|(id, _)| id)
        }).unwrap();
        updated.active_member(&id).unwrap().clone()
    }

    fn set(&self, room: &Room, member: &Member, model: Option<&str>) -> Result<Room, crate::terminal::AppError> {
        self.store.set_member_model(&room.id, &member.id, &member.tab_id, &member.agent, member.model_override.as_deref(), model)
    }

    fn selected(&self, room: &Room, tab: &str) -> Option<String> {
        self.store.model_override_for(tab, &room.project_root, AgentKind::Codex).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); }
}

#[test]
fn legacy_members_inherit_and_round_trip_without_a_model_field() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let member = fixture.add(&room, "tab-a", "Builder");
    let value = serde_json::to_value(&member).unwrap();
    assert!(value.get("modelOverride").is_none());
    let legacy: Member = serde_json::from_value(value).unwrap();
    assert!(legacy.model_override.is_none());
    let restored = RoomStore::load(Some(fixture.root.join("rooms")));
    assert_eq!(restored.model_override_for("tab-a", &room.project_root, AgentKind::Codex).unwrap(), None);
}

#[test]
fn role_models_survive_reload_and_clear_without_sending_messages() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let member = fixture.add(&room, "tab-a", "Builder");
    let before = fixture.store.get(&room.id).unwrap();
    let changed = fixture.set(&room, &member, Some("  model-a  ")).unwrap();
    assert_eq!(changed.active_member(&member.id).unwrap().model_override.as_deref(), Some("model-a"));
    assert_eq!(serde_json::to_value(&changed.messages).unwrap(), serde_json::to_value(&before.messages).unwrap());
    assert_eq!(serde_json::to_value(&changed.delivery_outbox).unwrap(), serde_json::to_value(&before.delivery_outbox).unwrap());
    assert_eq!(changed.ledger_bytes, before.ledger_bytes);
    let restored = RoomStore::load(Some(fixture.root.join("rooms")));
    assert_eq!(restored.model_override_for("tab-a", &room.project_root, AgentKind::Codex).unwrap().as_deref(), Some("model-a"));
    let member = changed.active_member(&member.id).unwrap();
    fixture.set(&room, member, None).unwrap();
    let restored = RoomStore::load(Some(fixture.root.join("rooms")));
    assert_eq!(restored.model_override_for("tab-a", &room.project_root, AgentKind::Codex).unwrap(), None);
}

#[test]
fn two_roles_of_the_same_agent_keep_independent_models() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let a = fixture.add(&room, "tab-a", "Builder");
    let b = fixture.add(&room, "tab-b", "Reviewer");
    fixture.set(&room, &a, Some("build-model")).unwrap();
    fixture.set(&room, &b, Some("review-model")).unwrap();
    assert_eq!(fixture.selected(&room, "tab-a").as_deref(), Some("build-model"));
    assert_eq!(fixture.selected(&room, "tab-b").as_deref(), Some("review-model"));
    assert_eq!(fixture.selected(&room, "unrelated-tab"), None);
}

#[test]
fn stale_forms_cannot_overwrite_a_model_or_a_rebound_role() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let member = fixture.add(&room, "tab-a", "Builder");
    fixture.set(&room, &member, Some("newer-setting")).unwrap();
    assert!(fixture.set(&room, &member, Some("stale-setting")).is_err());
    assert_eq!(fixture.selected(&room, "tab-a").as_deref(), Some("newer-setting"));
    let mut fresh = fixture.store.get(&room.id).unwrap().active_member(&member.id).unwrap().clone();
    fixture.store.mutate(&room.id, |room| {
        room.members.iter_mut().find(|m| m.id == member.id).unwrap().tab_id = "tab-b".into();
        Ok(())
    }).unwrap();
    assert!(fixture.set(&room, &fresh, Some("wrong-tab")).is_err());
    assert_eq!(fixture.selected(&room, "tab-a"), None);
    fresh.tab_id = "tab-b".into();
    fixture.store.mutate(&room.id, |room| {
        room.members.iter_mut().find(|m| m.id == member.id).unwrap().agent = "claude".into();
        Ok(())
    }).unwrap();
    assert!(fixture.set(&room, &fresh, Some("wrong-agent")).is_err());
    assert!(fixture.store.model_override_for("tab-b", &room.project_root, AgentKind::Codex).is_err());
}

#[test]
fn shared_sessions_require_clear_models_before_launching() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let a = fixture.add(&room, "shared", "Builder");
    let updated = fixture.set(&room, &a, Some("model-a")).unwrap();
    let other = fixture.room("Other");
    let b = fixture.add(&other, "shared", "Reviewer");
    assert!(fixture.set(&other, &b, Some("model-b")).is_err());
    assert!(fixture.store.model_override_for("shared", &room.project_root, AgentKind::Codex).is_err());
    fixture.set(&room, updated.active_member(&a.id).unwrap(), None).unwrap();
    assert_eq!(fixture.selected(&room, "shared"), None);
}

#[test]
fn models_do_not_leak_to_other_projects_or_departed_members() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let a = fixture.add(&room, "tab-a", "Builder");
    fixture.set(&room, &a, Some("model-a")).unwrap();
    let other_path = fixture.root.join("other-project");
    fs::create_dir(&other_path).unwrap();
    let other = fixture.store.create("Other", other_path.to_str().unwrap(), "").unwrap();
    let b = fixture.add(&other, "tab-a", "Builder");
    fixture.set(&other, &b, Some("model-b")).unwrap();
    assert_eq!(fixture.selected(&room, "tab-a").as_deref(), Some("model-a"));
    assert_eq!(fixture.selected(&other, "tab-a").as_deref(), Some("model-b"));
    fixture.store.mutate(&room.id, |room| {
        room.members.iter_mut().find(|m| m.id == a.id).unwrap().left_at = Some(2);
        Ok(())
    }).unwrap();
    assert_eq!(fixture.selected(&room, "tab-a"), None);
    assert!(fixture.set(&room, &a, Some("stale-model")).is_err());
}

#[cfg(unix)]
#[test]
fn project_aliases_use_the_same_role_model() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let member = fixture.add(&room, "tab-a", "Builder");
    fixture.set(&room, &member, Some("model-a")).unwrap();
    let alias = fixture.root.join("project-alias");
    std::os::unix::fs::symlink(&room.project_root, &alias).unwrap();
    assert_eq!(fixture.store.model_override_for("tab-a", alias.to_str().unwrap(), AgentKind::Codex).unwrap().as_deref(), Some("model-a"));
}

#[test]
fn invalid_model_identifiers_do_not_change_saved_settings() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let member = fixture.add(&room, "tab-a", "Builder");
    for invalid in ["", " \t ", "model name", "a\nb", "a\0b", &"x".repeat(257)] {
        assert!(fixture.set(&room, &member, Some(invalid)).is_err(), "{invalid:?}");
        assert_eq!(fixture.selected(&room, "tab-a"), None);
    }
    assert_eq!(member_model::normalize(Some("vendor/model:variant")).unwrap().as_deref(), Some("vendor/model:variant"));
}

#[test]
fn failed_save_leaves_the_previous_model_in_memory_and_on_disk() {
    let fixture = Fixture::new();
    let room = fixture.room("Room");
    let member = fixture.add(&room, "tab-a", "Builder");
    super::store::fail_next_commit("rename");
    assert!(fixture.set(&room, &member, Some("unsaved-model")).is_err());
    assert_eq!(fixture.selected(&room, "tab-a"), None);
    let restored = RoomStore::load(Some(fixture.root.join("rooms")));
    assert_eq!(restored.model_override_for("tab-a", &room.project_root, AgentKind::Codex).unwrap(), None);
}
