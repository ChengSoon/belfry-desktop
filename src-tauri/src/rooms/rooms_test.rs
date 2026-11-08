use std::fs;
use std::path::PathBuf;

use super::model::*;
use super::ops;
use super::store::{deliveries, RoomStore};

fn temp_root(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("belfry-rooms-{tag}-{}", new_id()))
}

#[test]
fn regression_room_notices_and_recipient_aliases_follow_the_app_language() {
    belfry_i18n::with_locale(belfry_i18n::Locale::En, || {
        let root = temp_root("locale");
        let store = RoomStore::load(Some(root.clone()));
        let mut room = store.create("用户的项目", "/proj", "用户的目标").unwrap();
        super::test_support::add(&mut room, "lead", "Lead", "coordination").unwrap();
        super::test_support::add(&mut room, "worker", "Worker", "implementation").unwrap();
        let welcome = room.messages.iter().find(|message| message.text.contains("belfry room status")).unwrap();
        assert!(welcome.text.contains("You joined room"), "{}", welcome.text);
        assert!(welcome.text.contains("用户的项目") && welcome.text.contains("用户的目标"));
        assert!(!welcome.text.contains("你是统筹"));
        assert!(room.messages.iter().any(|message| message.text.contains("joined the room")));
        let leader = room.foreman().unwrap().clone();
        let worker = room.member_by_tab("worker").unwrap();
        assert_eq!(resolve_recipients(&room, &Actor::Member(&leader), &["@members".into()], "").unwrap(), vec![worker.id.clone()]);
        assert_eq!(resolve_recipients(&room, &Actor::Member(worker), &[], "@coordinator review").unwrap(), vec![leader.id.clone()]);
        let body = "用户原文：已完成";
        let posted = ops::say(&mut room, &Actor::User, &[], body, None, false, now_millis()).unwrap();
        assert_eq!(room.message(&posted.message_id).unwrap().text, body);
        let _ = fs::remove_dir_all(root);
    });
}

fn delivery_registry() -> crate::collab::SessionRegistry {
    let registry = crate::collab::SessionRegistry::default();
    registry.replace(vec![serde_json::from_value(serde_json::json!({
        "tabId": "t1", "name": "worker", "title": "Worker", "agent": "codex", "activity": "idle",
        "canReceive": true, "projectRoot": "/proj"
    })).unwrap()]);
    registry
}

#[test]
fn regression_room_outbox_recovers_a_commit_without_board_acceptance() {
    use crate::collab::task::{TaskBoard, DeliveryPhase};
    let root = temp_root("outbox-recovery");
    let store = RoomStore::load(Some(root.join("rooms")));
    let room = store.create("Room", "/proj", "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "Worker", "")).unwrap();
    let (posted, _) = store.mutate(&room.id, |room| ops::say(room, &Actor::User, &[], "durable message", None, false, 1)).unwrap();
    // 模拟房间已经成功落盘，但进程在调用 TaskBoard 之前退出。
    drop(store);
    let store = RoomStore::load(Some(root.join("rooms")));
    let board = TaskBoard::load(Some(root.join("collab")));
    let registry = delivery_registry();
    store.pump_outbox(&board, &registry).unwrap();
    let task = board.snapshot().into_iter().find(|task| task.chat.as_ref().unwrap().message_ids.contains(&posted.message_id))
        .expect("accepted room messages must recover their pending delivery");
    assert!(board.claim_delivery(&task.id, "attempt").unwrap());
    assert!(board.delivery_update(&task.id, "attempt", 1, DeliveryPhase::Queued, None).unwrap());
    store.reconcile(&board).unwrap();
    assert!(store.get(&room.id).unwrap().message(&posted.message_id).unwrap().delivered_to.is_empty(), "排队不能记作送达");
    assert!(board.delivery_update(&task.id, "attempt", 2, DeliveryPhase::Submitting, None).unwrap());
    assert!(board.delivery_update(&task.id, "attempt", 3, DeliveryPhase::Submitted, None).unwrap());
    // submitted 已经落盘，但对应房间回执的提交失败。
    super::store::fail_next_commit("rename");
    assert!(store.reconcile(&board).is_err());
    drop(store);
    drop(board);
    let store = RoomStore::load(Some(root.join("rooms")));
    let board = TaskBoard::load(Some(root.join("collab")));
    assert!(board.pending().is_empty());
    store.pump_outbox(&board, &registry).unwrap();
    assert!(board.snapshot().is_empty());
    let room = store.get(&room.id).unwrap();
    assert!(!room.message(&posted.message_id).unwrap().delivered_to.is_empty());
    assert!(room.delivery_outbox.is_empty());
    store.pump_outbox(&board, &registry).unwrap();
    assert!(board.snapshot().is_empty(), "重启后回执补交成功，不能再次投递");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_stale_room_delivery_snapshot_cannot_reenqueue_after_receipt_cleanup() {
    use crate::collab::task::{TaskBoard, DeliveryPhase};
    let root = temp_root("stale-outbox");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("Room", "/proj", "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "Worker", "")).unwrap();
    let (posted, room) = store.mutate(&room.id, |room| ops::say(room, &Actor::User, &[], "only once", None, false, 1)).unwrap();
    let posts = deliveries(&room, &[posted]);
    let board = TaskBoard::default();
    let registry = delivery_registry();
    store.pump_outbox(&board, &registry).unwrap();
    for task in board.snapshot() {
        assert!(board.claim_delivery(&task.id, "attempt").unwrap());
        assert!(board.delivery_update(&task.id, "attempt", 1, DeliveryPhase::Submitting, None).unwrap());
        assert!(board.delivery_update(&task.id, "attempt", 2, DeliveryPhase::Submitted, None).unwrap());
    }
    store.reconcile(&board).unwrap();
    assert!(board.snapshot().is_empty());
    store.enqueue_posts(&board, &registry, &posts).unwrap();
    assert!(board.snapshot().is_empty(), "迟到的快照不得复活已清理的投递");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn regression_snapshot_rename_failure_does_not_publish_ledger_messages() {
    let root = temp_root("rename-failure");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("一致性", "/proj", "original").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "统筹员", "")).unwrap();
    let file = root.join("rooms.json");
    let before = fs::read(&file).unwrap();
    fs::remove_file(&file).unwrap();
    fs::create_dir(&file).unwrap();
    assert!(store.mutate(&room.id, |room| {
        room.brief.objective = "uncommitted objective".into();
        ops::say(room, &Actor::User, &[], "ghost notification", None, true, now_millis())
    }).is_err());
    fs::remove_dir(&file).unwrap();
    fs::write(&file, before).unwrap();
    let reloaded = RoomStore::load(Some(root.clone())).get(&room.id).unwrap();
    assert_eq!(reloaded.brief.objective, "original");
    assert!(!reloaded.messages.iter().any(|message| message.text == "ghost notification"), "rename 失败的消息不能在重启后冒出来");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn regression_active_reply_survives_more_than_three_thousand_events_and_restart() {
    let root = temp_root("retained-reply");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("长对话", "/proj", "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "统筹员", "")).unwrap();
    let (asked, _) = store.mutate(&room.id, |room| ops::say(room, &Actor::User, &[], "earliest open question", None, true, now_millis())).unwrap();
    store.mutate(&room.id, |room| {
        for index in 0..3100 {
            let message = Message { id: new_id(), at: now_millis() + index, kind: MessageKind::Notice, by: "system".into(), text: format!("history {index}"), to: Vec::new(), mode: MessageMode::Send, reply_to: None, attachments: Vec::new(), delivered_to: Vec::new(), replied_by: Vec::new(), reply_cancelled: false };
            let event = super::ledger::message_event(&room.id, &message);
            super::ledger::apply(room, &event);
            room.pending.push(event);
        }
        Ok(())
    }).unwrap();
    let reloaded = RoomStore::load(Some(root.clone()));
    let room = reloaded.get(&room.id).unwrap();
    assert!(room.message(&asked.message_id).is_some(), "最近消息截断不能抹掉活跃回复义务");
    assert_eq!(room.messages.len(), MAX_MESSAGES);
    let (reply, room) = reloaded.mutate(&room.id, |room| {
        let member = room.foreman().unwrap().clone();
        ops::say(room, &Actor::Member(&member), &[], "reply after restart", Some(&short_id(&asked.message_id)), false, now_millis())
    }).unwrap();
    assert!(room.message(&asked.message_id).unwrap().awaiting().is_empty());
    assert_eq!(room.message(&reply.message_id).unwrap().reply_to.as_deref(), Some(asked.message_id.as_str()));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn regression_unknown_ledger_records_are_never_removed_by_startup_compaction() {
    let root = temp_root("unknown-events");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("兼容历史", "/proj", "").unwrap();
    let path = super::ledger::path(&root, &room.id).unwrap();
    let events: Vec<_> = (0..3100).map(|index| super::ledger::LedgerEvent {
        v: 1, id: new_id(), ts: index, kind: "future.unknown".into(), room_id: room.id.clone(), by: "system".into(), data: serde_json::json!({"preserve": index})
    }).collect();
    super::ledger::append(&path, &events).unwrap();
    // 模拟升级前无提交游标的原始 v1 账本。
    let file = root.join("rooms.json");
    let mut snapshot: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    snapshot["version"] = serde_json::json!(1);
    fs::write(file, serde_json::to_vec(&snapshot).unwrap()).unwrap();
    let original = fs::read(&path).unwrap();
    RoomStore::load(Some(root.clone())).get(&room.id).unwrap();
    assert!(fs::read(&path).unwrap() == original, "未知事件必须逐字保留");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn regression_a_stale_store_cannot_overwrite_another_instances_commit() {
    let root = temp_root("stale-writer");
    let first = RoomStore::load(Some(root.clone()));
    let room = first.create("original", "/proj", "").unwrap();
    let stale = RoomStore::load(Some(root.clone()));
    first.mutate(&room.id, |room| { room.name = "new name".into(); Ok(()) }).unwrap();
    assert!(stale.mutate(&room.id, |room| { room.brief.objective = "stale".into(); Ok(()) }).is_err());
    assert_eq!(RoomStore::load(Some(root.clone())).get(&room.id).unwrap().name, "new name");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn append_sync_and_commit_faults_restart_at_the_previous_commit_and_retry_once() {
    for stage in ["append", "sync", "rename"] {
        let root = temp_root(stage);
        let store = RoomStore::load(Some(root.clone()));
        let room = store.create("transaction", "/proj", "old").unwrap();
        store.mutate(&room.id, |room| super::test_support::add(room, "t1", "统筹员", "")).unwrap();
        super::store::fail_next_commit(stage);
        assert!(store.mutate(&room.id, |room| {
            room.brief.objective = "failed".into();
            ops::say(room, &Actor::User, &[], "failed message", None, false, now_millis())
        }).is_err());
        let recovered = RoomStore::load(Some(root.clone())).get(&room.id).unwrap();
        assert_eq!(recovered.brief.objective, "old", "{stage}");
        assert!(recovered.all_messages().all(|message| message.text != "failed message"), "{stage}: ghost event");
        store.mutate(&room.id, |room| {
            room.brief.objective = "committed".into();
            ops::say(room, &Actor::User, &[], "successful retry", None, false, now_millis())
        }).unwrap();
        let recovered = RoomStore::load(Some(root.clone())).get(&room.id).unwrap();
        assert_eq!(recovered.brief.objective, "committed");
        assert_eq!(recovered.all_messages().filter(|message| message.text == "successful retry").count(), 1);
        assert!(recovered.all_messages().all(|message| message.text != "failed message"));
        let _ = fs::remove_dir_all(root);
    }
}

#[test]
fn truncated_committed_ledgers_are_readonly_instead_of_silently_losing_messages() {
    let root = temp_root("short-ledger");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("truncated", "/proj", "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "统筹员", "")).unwrap();
    let path = super::ledger::path(&root, &room.id).unwrap();
    fs::write(&path, "{broken").unwrap();
    let recovered = RoomStore::load(Some(root.clone()));
    assert!(recovered.list().unwrap().load_error.is_some());
    assert!(recovered.create("new", "/proj", "").is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "{broken");
    let _ = fs::remove_dir_all(root);
}

/// 一间房：统筹 + 前端 + 后端，第一位自动当统筹。
fn team() -> Room {
    let mut room = Room {
        id: new_id(),
        name: "登录改版".into(),
        project_root: "/proj".into(),
        created_at: 0,
        brief: Brief { objective: "做完新的登录页".into(), ..Brief::default() },
        members: Vec::new(),
        tasks: Vec::new(),
        next_task: 1,
        idle_nudged_after: None,
        paused: false,
        messages: Vec::new(),
        retained_messages: Vec::new(),
        delivery_outbox: Vec::new(),
        ledger_bytes: 0,
        pending: Vec::new(),
    };
    for (tab, title, duty) in [("t1", "统筹员", "拆活验收"), ("t2", "前端", "页面"), ("t3", "后端", "接口")] {
        ops::add_member(&mut room, tab, "claude", title, duty, false, 1).unwrap();
    }
    room
}

fn member<'a>(room: &'a Room, title: &str) -> &'a Member {
    room.member_by_title(title).unwrap()
}

fn as_member(room: &Room, title: &str) -> Member {
    member(room, title).clone()
}

#[test]
fn the_first_member_becomes_foreman_and_everyone_gets_onboarded() {
    let room = team();
    assert_eq!(room.foreman().unwrap().title, "统筹员");
    assert_eq!(member(&room, "前端").role, MemberRole::Peer);
    let foreman_intro = room
        .messages
        .iter()
        .find(|m| m.to == vec![member(&room, "统筹员").id.clone()])
        .unwrap();
    assert!(foreman_intro.text.contains("你是统筹") && foreman_intro.text.contains("做完新的登录页"));
    let peer_intro = room.messages.iter().find(|m| m.to == vec![member(&room, "前端").id.clone()]).unwrap();
    assert!(peer_intro.text.contains("你是成员") && peer_intro.text.contains("belfry room task done"));
}

#[test]
fn titles_must_be_unique_spaceless_and_not_a_recipient_token() {
    let mut room = team();
    for bad in ["前端", "前 端", "统筹", "@全体", ""] {
        assert!(ops::add_member(&mut room, "t9", "codex", bad, "", false, 2).is_err(), "{bad}");
    }
    assert!(ops::add_member(&mut room, "t2", "codex", "测试", "", false, 2).is_err(), "同一条会话不能进两次");
}

#[test]
fn messages_default_to_the_foreman_and_the_foreman_defaults_to_everyone() {
    let mut room = team();
    let frontend = as_member(&room, "前端");
    let foreman = as_member(&room, "统筹员");
    let posted = ops::say(&mut room, &Actor::Member(&frontend), &[], "我卡住了", None, false, 5).unwrap();
    assert_eq!(posted.to, vec![foreman.id.clone()]);
    let posted = ops::say(&mut room, &Actor::User, &[], "大家好", None, false, 6).unwrap();
    assert_eq!(posted.to, vec![foreman.id.clone()], "用户不写收件人也先发给统筹");
    let posted = ops::say(&mut room, &Actor::Member(&foreman), &[], "开工", None, false, 7).unwrap();
    assert_eq!(posted.to.len(), 2, "统筹不写收件人发给全体成员");
    assert!(!posted.to.contains(&foreman.id), "发件人自己不在收件人里");
}

#[test]
fn mentions_and_selectors_pick_recipients_and_audiences_never_mix() {
    let mut room = team();
    let foreman = as_member(&room, "统筹员");
    let backend = member(&room, "后端").id.clone();
    let posted = ops::say(&mut room, &Actor::Member(&foreman), &[], "@后端 接口今天能定吗", None, false, 5).unwrap();
    assert_eq!(posted.to, vec![backend.clone()]);
    let posted = ops::say(&mut room, &Actor::User, &["@全体".into()], "同步一下", None, false, 6).unwrap();
    assert_eq!(posted.to.len(), 3);
    let posted = ops::say(&mut room, &Actor::Member(&foreman), &["@用户".into()], "做完了", None, false, 7).unwrap();
    assert_eq!(posted.to, vec!["user".to_string()]);
    let mixed = ops::say(&mut room, &Actor::Member(&foreman), &["@用户".into(), "后端".into()], "x", None, false, 8);
    assert!(mixed.unwrap_err().contains("分成两条"));
    let unknown = ops::say(&mut room, &Actor::User, &["设计".into()], "x", None, false, 9);
    assert!(unknown.unwrap_err().contains("没有「设计」"));
}

#[test]
fn a_longer_title_shadows_a_shorter_one_and_words_are_not_mentions() {
    let mut room = team();
    ops::add_member(&mut room, "t4", "codex", "前端2", "", false, 2).unwrap();
    assert_eq!(mentions_in(&room, "@前端2 看下"), vec!["@前端2".to_string()]);
    assert!(mentions_in(&room, "@前端们 都看下").is_empty(), "后面紧跟汉字算词的一部分");
}

#[test]
fn request_reply_stays_open_until_each_recipient_replies() {
    let mut room = team();
    let foreman = as_member(&room, "统筹员");
    let frontend = as_member(&room, "前端");
    let ask = ops::say(&mut room, &Actor::Member(&foreman), &["@成员".into()], "今天能交吗", None, true, 5).unwrap();
    let asked = room.message(&ask.message_id).unwrap().clone();
    assert_eq!(asked.awaiting().len(), 2);
    let reply = ops::say(&mut room, &Actor::Member(&frontend), &[], "能", Some(&short_id(&ask.message_id)), false, 6).unwrap();
    assert_eq!(reply.to, vec![foreman.id.clone()], "回复默认回给原发件人");
    assert_eq!(room.message(&ask.message_id).unwrap().awaiting(), vec![member(&room, "后端").id.clone()]);
    assert!(ops::say(&mut room, &Actor::Member(&frontend), &[], "x", Some(&ask.message_id), true, 7).is_err(), "回复不能再要求回复");
    assert!(ops::cancel_reply(&mut room, &Actor::Member(&frontend), &ask.message_id, 8).is_err(), "只有发件人能撤");
    ops::cancel_reply(&mut room, &Actor::Member(&foreman), &ask.message_id, 8).unwrap();
    assert!(room.message(&ask.message_id).unwrap().awaiting().is_empty());
}

#[test]
fn peers_cannot_assign_work_to_other_peers_but_can_claim_open_tasks() {
    let mut room = team();
    let frontend = as_member(&room, "前端");
    let foreman = as_member(&room, "统筹员");
    let refused = ops::task_add(&mut room, &Actor::Member(&frontend), "写接口", None, Some("后端"), &[], 5);
    assert!(refused.unwrap_err().contains("不能给别的成员派活"));
    let (mine, _) = ops::task_add(&mut room, &Actor::Member(&frontend), "页面骨架", None, Some("前端"), &[], 5).unwrap();
    assert_eq!(mine, "T1");
    let (open, _) = ops::task_add(&mut room, &Actor::Member(&foreman), "补文档", None, None, &[], 6).unwrap();
    assert!(ops::task_assign(&mut room, &Actor::Member(&frontend), &open, "后端", 7).is_err(), "成员不能替别人认领");
    ops::task_assign(&mut room, &Actor::Member(&frontend), &open, "前端", 7).unwrap();
    let backend = as_member(&room, "后端");
    assert!(ops::task_start(&mut room, &Actor::Member(&backend), "T1", 8).unwrap_err().contains("不是你负责的"));
}

#[test]
fn a_peer_creating_a_task_tells_the_foreman() {
    let mut room = team();
    let frontend = as_member(&room, "前端");
    let (_, posted) = ops::task_add(&mut room, &Actor::Member(&frontend), "补测试", None, Some("前端"), &[], 5).unwrap();
    assert_eq!(posted[0].to, vec![member(&room, "统筹员").id.clone()]);
}

#[test]
fn finishing_work_notifies_the_foreman_and_unlocks_dependents() {
    let mut room = team();
    let foreman = as_member(&room, "统筹员");
    let actor = Actor::Member(&foreman);
    ops::task_add(&mut room, &actor, "接口", Some("返回 token"), Some("后端"), &[], 5).unwrap();
    let (page, posted) = ops::task_add(&mut room, &actor, "登录页", None, Some("前端"), &["T1".into()], 6).unwrap();
    assert_eq!(posted[0].to, vec![member(&room, "前端").id.clone()]);
    assert!(room.message(&posted[0].message_id).unwrap().text.contains("要等 T1"));

    let frontend = as_member(&room, "前端");
    assert!(ops::task_start(&mut room, &Actor::Member(&frontend), &page, 7).unwrap_err().contains("还在等 T1"));

    let backend = as_member(&room, "后端");
    ops::task_start(&mut room, &Actor::Member(&backend), "t1", 8).unwrap();
    let posted = ops::task_done(&mut room, &Actor::Member(&backend), "1", Some("已合并"), 9).unwrap();
    let to_foreman = room.message(&posted[0].message_id).unwrap();
    assert_eq!(to_foreman.to, vec![foreman.id.clone()]);
    assert!(to_foreman.text.contains("已合并") && to_foreman.text.contains("手上没有别的活了"), "{}", to_foreman.text);
    let unlock = room.message(&posted[1].message_id).unwrap();
    assert_eq!(unlock.to, vec![frontend.id.clone()]);
    assert!(unlock.text.contains("可以开工") && unlock.text.contains("T2"));

    ops::task_start(&mut room, &Actor::Member(&frontend), &page, 10).unwrap();
    let posted = ops::task_done(&mut room, &Actor::Member(&frontend), &page, None, 11).unwrap();
    assert!(room.message(&posted[0].message_id).unwrap().text.contains("都完成了"));
    assert_eq!(room.tasks[1].rev, 3, "建、开工、完成各加一次");
}

#[test]
fn only_coordinators_reopen_finished_work_and_archive() {
    let mut room = team();
    let foreman = as_member(&room, "统筹员");
    let frontend = as_member(&room, "前端");
    ops::task_add(&mut room, &Actor::Member(&foreman), "页面", None, Some("前端"), &[], 5).unwrap();
    ops::task_done(&mut room, &Actor::Member(&frontend), "T1", Some("好了"), 6).unwrap();
    assert!(ops::task_reopen(&mut room, &Actor::Member(&frontend), "T1", 7).unwrap_err().contains("统筹或用户"));
    assert!(ops::task_archive(&mut room, &Actor::Member(&frontend), "T1", 7).is_err());
    let posted = ops::task_reopen(&mut room, &Actor::Member(&foreman), "T1", 8).unwrap();
    assert_eq!(posted[0].to, vec![frontend.id.clone()]);
    assert_eq!(room.tasks[0].result, None);
    ops::task_archive(&mut room, &Actor::User, "T1", 9).unwrap();
    let (next, _) = ops::task_add(&mut room, &Actor::User, "下一件", None, None, &[], 10).unwrap();
    assert_eq!(next, "T2", "编号不复用");
}

#[test]
fn only_coordinators_edit_the_brief_and_members_hear_about_it() {
    let mut room = team();
    let frontend = as_member(&room, "前端");
    assert!(ops::update_brief(&mut room, &Actor::Member(&frontend), Some("改目标"), None, None, 5).is_err());
    let posted = ops::update_brief(&mut room, &Actor::User, None, Some("先做手机号登录"), Some(vec!["不动后端协议".into()]), 6).unwrap();
    assert_eq!(posted.to.len(), 3);
    assert_eq!(room.brief.current_focus, "先做手机号登录");
    assert_eq!(room.brief.constraints, vec!["不动后端协议".to_string()]);
    assert_eq!(room.brief.objective, "做完新的登录页", "没给的字段不动");
}

#[test]
fn when_the_foreman_leaves_the_earliest_member_takes_over_and_orphans_are_flagged() {
    let mut room = team();
    let frontend_id = member(&room, "前端").id.clone();
    ops::task_add(&mut room, &Actor::User, "页面", None, Some("前端"), &[], 5).unwrap();
    ops::remove_member(&mut room, &frontend_id, 6).unwrap();
    assert_eq!(room.tasks[0].assignee, None);
    let flagged = room.messages.last().unwrap();
    assert!(flagged.text.contains("T1") && flagged.to == vec![room.foreman().unwrap().id.clone()]);

    let foreman_id = room.foreman().unwrap().id.clone();
    ops::remove_member(&mut room, &foreman_id, 7).unwrap();
    assert_eq!(room.foreman().unwrap().title, "后端");
}

#[test]
fn switching_the_foreman_tells_both_sides() {
    let mut room = team();
    let backend = member(&room, "后端").id.clone();
    let old = member(&room, "统筹员").id.clone();
    let posted = ops::set_foreman(&mut room, &backend, 5).unwrap();
    assert_eq!(room.foreman().unwrap().id, backend);
    assert_eq!(member(&room, "统筹员").role, MemberRole::Peer);
    assert!(posted.iter().any(|p| p.to == vec![backend.clone()]));
    assert!(posted.iter().any(|p| p.to == vec![old.clone()]));
}

#[test]
fn deliveries_carry_the_short_id_author_and_quote() {
    let mut room = team();
    let foreman = as_member(&room, "统筹员");
    let first = ops::say(&mut room, &Actor::User, &[], "先做登录", None, false, 5).unwrap();
    let reply = ops::say(&mut room, &Actor::Member(&foreman), &["@前端".into()], "收到", Some(&first.message_id), false, 6).unwrap();
    let posts = deliveries(&room, std::slice::from_ref(&reply));
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].tab_id, "t2");
    assert!(posts[0].line.starts_with(&format!("[{}] 统筹员：收到", short_id(&reply.message_id))), "{}", posts[0].line);
    assert!(posts[0].line.contains("回复") && posts[0].line.contains("先做登录"));
    let to_user = ops::say(&mut room, &Actor::Member(&foreman), &["@用户".into()], "好了", None, false, 7).unwrap();
    assert!(deliveries(&room, &[to_user]).is_empty(), "发给用户的不进终端");
}

#[test]
fn the_store_persists_rooms_and_the_committed_message_projection() {
    let root = temp_root("persist");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("登录改版", "/proj", "做完登录页").unwrap();
    store
        .mutate(&room.id, |room| {
            super::test_support::add(room, "t1", "统筹员", "")?;
            super::test_support::add(room, "t2", "前端", "")
        })
        .unwrap();
    let (posted, _) = store
        .mutate(&room.id, |room| ops::say(room, &Actor::User, &["@前端".into()], "要求回复", None, true, now_millis()))
        .unwrap();
    store
        .mutate(&room.id, |room| ops::task_add(room, &Actor::User, "页面", None, Some("前端"), &[], now_millis()))
        .unwrap();
    store.mutate(&room.id, |room| Ok(ops::record_delivery(room, &posted.message_id, &room.members[1].id.clone(), 9))).unwrap();

    let json = fs::read_to_string(root.join("rooms.json")).unwrap();
    assert!(json.contains("要求回复"), "当前投影随提交游标一起保存，启动无需重放完整账本");
    let reloaded = RoomStore::load(Some(root.clone())).get(&room.id).unwrap();
    let before = store.get(&room.id).unwrap();
    assert_eq!(reloaded.messages.len(), before.messages.len());
    let asked = reloaded.message(&posted.message_id).unwrap();
    assert_eq!(asked.mode, MessageMode::RequestReply);
    assert_eq!(asked.delivered_to.len(), 1);
    assert_eq!(reloaded.tasks[0].id, "T1");
    assert_eq!(reloaded.next_task, 2);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_failed_action_leaves_the_store_untouched() {
    let root = temp_root("rollback");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("登录改版", "/proj", "").unwrap();
    let result = store.mutate(&room.id, |room| {
        super::test_support::add(room, "t1", "统筹员", "")?;
        Err::<(), _>("中途失败".to_string())
    });
    assert!(result.is_err());
    assert!(store.get(&room.id).unwrap().members.is_empty(), "失败的动作不留半截");
    assert!(!root.join("ledgers").join(format!("{}.jsonl", room.id)).exists());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_torn_ledger_line_is_skipped_and_duplicates_replay_once() {
    let root = temp_root("torn");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("登录改版", "/proj", "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "统筹员", "")).unwrap();
    let ledger = root.join("ledgers").join(format!("{}.jsonl", room.id));
    let text = fs::read_to_string(&ledger).unwrap();
    fs::write(&ledger, format!("{text}{text}{{\"v\":1,\"id\":\"half")).unwrap();
    let reloaded = RoomStore::load(Some(root.clone()));
    assert_eq!(reloaded.get(&room.id).unwrap().messages.len(), store.get(&room.id).unwrap().messages.len());
    reloaded.mutate(&room.id, |room| ops::say(room, &Actor::User, &[], "之后", None, false, now_millis())).unwrap();
    let again = RoomStore::load(Some(root.clone())).get(&room.id).unwrap();
    assert_eq!(again.messages.last().unwrap().text, "之后", "补了换行再追加");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn an_unknown_store_version_stays_readonly_and_keeps_the_file() {
    let root = temp_root("version");
    fs::create_dir_all(&root).unwrap();
    let original = r#"{ "version": 99, "rooms": [] }"#;
    fs::write(root.join("rooms.json"), original).unwrap();
    let store = RoomStore::load(Some(root.clone()));
    assert!(store.list().unwrap().load_error.is_some());
    assert!(store.create("新房间", "/proj", "").is_err());
    assert_eq!(fs::read_to_string(root.join("rooms.json")).unwrap(), original);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn deleting_a_room_removes_its_ledger() {
    let root = temp_root("delete");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("登录改版", "/proj", "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "统筹员", "")).unwrap();
    let ledger = root.join("ledgers").join(format!("{}.jsonl", room.id));
    assert!(ledger.exists());
    store.delete(&room.id).unwrap();
    assert!(!ledger.exists());
    assert!(store.list().unwrap().rooms.is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_users_message_to_the_foreman_carries_the_member_roster() {
    let mut room = team();
    ops::task_add(&mut room, &Actor::User, "页面", None, Some("前端"), &[], 2).unwrap();
    let posted = ops::say(&mut room, &Actor::User, &[], "做个登录页", None, false, 5).unwrap();
    let posts = deliveries(&room, std::slice::from_ref(&posted));
    assert_eq!(posts.len(), 1);
    assert!(posts[0].line.contains("可以派活的成员：前端（页面，手上 1 件）、后端（接口，手上 0 件）"), "{}", posts[0].line);
    assert!(posts[0].line.contains("belfry room task add"));
    // 成员之间的消息、发给成员的消息都不附名单。
    let foreman = as_member(&room, "统筹员");
    let posted = ops::say(&mut room, &Actor::Member(&foreman), &["@后端".into()], "看下", None, false, 6).unwrap();
    assert!(!deliveries(&room, &[posted])[0].line.contains("可以派活"));
}

#[test]
fn the_foreman_is_told_to_delegate_through_the_task_board() {
    let room = team();
    let intro = room.messages.iter().find(|m| m.to == vec![member(&room, "统筹员").id.clone()]).unwrap();
    assert!(intro.text.contains("主要工作是协调") && intro.text.contains("不要用 belfry send"), "{}", intro.text);
}

#[test]
fn idle_members_trigger_one_nudge_per_quiet_period() {
    let mut room = team();
    let idle = |_: &Member| true;
    let start = 1_000_000;
    ops::say(&mut room, &Actor::User, &[], "做个登录页", None, false, start).unwrap();
    assert!(ops::idle_nudge(&mut room, &idle, start + ops::IDLE_NUDGE_MS - 1).is_none(), "还没安静够");
    let posted = ops::idle_nudge(&mut room, &idle, start + ops::IDLE_NUDGE_MS).expect("该提醒了");
    assert_eq!(posted.to, vec![member(&room, "统筹员").id.clone()]);
    let text = &room.message(&posted.message_id).unwrap().text;
    assert!(text.starts_with(ops::IDLE_NUDGE_PREFIX) && text.contains("前端") && text.contains("后端"), "{text}");
    assert!(ops::idle_nudge(&mut room, &idle, start + ops::IDLE_NUDGE_MS * 3).is_none(), "同一段安静只提醒一次");

    // 有了新动静、又安静下来，可以再提醒一次。
    let later = start + ops::IDLE_NUDGE_MS * 4;
    ops::say(&mut room, &Actor::User, &[], "进度呢", None, false, later).unwrap();
    assert!(ops::idle_nudge(&mut room, &idle, later + ops::IDLE_NUDGE_MS).is_some());
}

#[test]
fn no_nudge_while_waiting_on_the_user_or_when_everyone_is_busy() {
    let start = 1_000_000;
    let quiet = start + ops::IDLE_NUDGE_MS;
    let idle = |_: &Member| true;

    let mut room = team();
    assert!(ops::idle_nudge(&mut room, &idle, quiet).is_none(), "没人提过需求");

    let mut room = team();
    let foreman = as_member(&room, "统筹员");
    ops::say(&mut room, &Actor::User, &[], "做个登录页", None, false, start - 10).unwrap();
    ops::say(&mut room, &Actor::Member(&foreman), &["@用户".into()], "做完了", None, false, start).unwrap();
    assert!(ops::idle_nudge(&mut room, &idle, quiet).is_none(), "统筹在等用户");

    let mut room = team();
    ops::say(&mut room, &Actor::User, &[], "做个登录页", None, false, start).unwrap();
    for title in ["前端", "后端"] {
        ops::task_add(&mut room, &Actor::User, "活", None, Some(title), &[], start).unwrap();
    }
    assert!(ops::idle_nudge(&mut room, &idle, quiet).is_none(), "成员手上都有活");

    let mut room = team();
    ops::say(&mut room, &Actor::User, &[], "做个登录页", None, false, start).unwrap();
    let foreman_tab = member(&room, "统筹员").tab_id.clone();
    assert!(ops::idle_nudge(&mut room, &|m: &Member| m.tab_id != foreman_tab, quiet).is_none(), "统筹正忙");
    assert!(ops::idle_nudge(&mut room, &|m: &Member| m.tab_id == foreman_tab, quiet).is_none(), "成员都在忙");
}

#[test]
fn a_paused_room_records_messages_but_delivers_nothing_and_stops_nudging() {
    let mut room = team();
    let start = 1_000_000;
    ops::say(&mut room, &Actor::User, &[], "做个登录页", None, false, start).unwrap();
    ops::set_paused(&mut room, true, start + 1).unwrap();
    assert!(ops::set_paused(&mut room, true, start + 2).is_err(), "不能重复暂停");
    let foreman = as_member(&room, "统筹员");
    let posted = ops::say(&mut room, &Actor::Member(&foreman), &["@前端".into()], "先做页面", None, false, start + 3).unwrap();
    assert!(room.message(&posted.message_id).is_some(), "消息照样记在房间里");
    assert!(deliveries(&room, &[posted]).is_empty(), "暂停时不送进终端");
    assert!(ops::idle_nudge(&mut room, &|_: &Member| true, start + ops::IDLE_NUDGE_MS * 10).is_none(), "暂停时不发空闲提醒");
    ops::set_paused(&mut room, false, start + 4).unwrap();
    let posted = ops::say(&mut room, &Actor::Member(&foreman), &["@前端".into()], "继续", None, false, start + 5).unwrap();
    assert_eq!(deliveries(&room, &[posted]).len(), 1, "恢复后照常送达");
}

#[test]
fn room_summaries_carry_the_latest_message_addressed_to_you() {
    let root = temp_root("inbox");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("登录改版", "/proj", "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "统筹员", "")).unwrap();
    assert!(store.list().unwrap().rooms[0].last_to_user.is_none());
    store.mutate(&room.id, |room| ops::say(room, &Actor::User, &[], "做个登录页", None, false, now_millis())).unwrap();
    assert!(store.list().unwrap().rooms[0].last_to_user.is_none(), "你自己发的不算");
    store.mutate(&room.id, |room| {
        let foreman = room.foreman().unwrap().clone();
        ops::say(room, &Actor::Member(&foreman), &["@用户".into()], "登录页做完了，请验收", None, false, now_millis())
    }).unwrap();
    let summary = &store.list().unwrap().rooms[0];
    let note = summary.last_to_user.as_ref().unwrap();
    assert_eq!((note.from.as_str(), note.text.as_str()), ("统筹员", "登录页做完了，请验收"));
    assert!(!summary.paused);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_long_legacy_ledger_keeps_its_history_while_bounding_the_recent_projection() {
    let root = temp_root("compact");
    let store = RoomStore::load(Some(root.clone()));
    let room = store.create("登录改版", "/proj", "").unwrap();
    store.mutate(&room.id, |room| super::test_support::add(room, "t1", "统筹员", "")).unwrap();
    let (asked, _) = store.mutate(&room.id, |room| ops::say(room, &Actor::User, &[], "要回复", None, true, now_millis())).unwrap();
    let member_id = store.get(&room.id).unwrap().members[0].id.clone();
    store.mutate(&room.id, |room| Ok(ops::record_delivery(room, &asked.message_id, &member_id, now_millis()))).unwrap();
    // 再追加一大段系统注记，让事件数超过压缩阈值。
    let path = super::ledger::path(&root, &room.id).unwrap();
    let mut filler = store.get(&room.id).unwrap();
    let extra: Vec<_> = (0..super::ledger::COMPACT_AFTER + 50)
        .map(|index| {
            let message = Message {
                id: new_id(), at: now_millis() + index as i64, kind: MessageKind::Notice, by: "system".into(),
                text: format!("注记 {index}"), to: Vec::new(), mode: MessageMode::Send, reply_to: None,
                attachments: Vec::new(), delivered_to: Vec::new(), replied_by: Vec::new(), reply_cancelled: false,
            };
            filler.messages.clear();
            super::ledger::message_event(&room.id, &message)
        })
        .collect();
    super::ledger::append(&path, &extra).unwrap();
    let file = root.join("rooms.json");
    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    legacy["version"] = serde_json::json!(1);
    fs::write(file, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let before = RoomStore::load(Some(root.clone())).get(&room.id).unwrap();
    let lines = fs::read_to_string(&path).unwrap().lines().count();
    assert!(lines > super::ledger::COMPACT_AFTER, "原始历史不再被最近投影覆写：{lines}");
    let after = RoomStore::load(Some(root.clone())).get(&room.id).unwrap();
    let ids = |room: &Room| room.messages.iter().map(|m| (m.id.clone(), m.delivered_to.clone(), m.replied_by.clone())).collect::<Vec<_>>();
    assert_eq!(ids(&after), ids(&before), "压缩前后投影一致");
    assert_eq!(after.messages.len(), MAX_MESSAGES);
    let _ = fs::remove_dir_all(&root);
}
