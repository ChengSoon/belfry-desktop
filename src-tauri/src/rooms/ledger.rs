//! 房间消息账本：每间房一份只追加的 JSONL（`rooms/ledgers/<roomId>.jsonl`）。
//!
//! 事件信封、kind 命名与写入规则移植自 CCCC 的 CCCS v1（Apache-2.0，出处见
//! `third_party/cccc/NOTICE.md`）。状态归属也照 CCCC：房间、成员、简报和任务板在
//! `rooms/rooms.json`；消息与关于消息的事实（送达、回复义务）只追加进账本，
//! `Room.messages` 是重放出来的投影。
//!
//! 与 CCCS 的差异：`ts` 存毫秒数（全仓库的时刻都是毫秒）；群组 id 叫 `room_id`；
//! `runtime.delivery` 只记 `accepted`（进过终端），不记读没读。

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::attachments::RoomAttachment;
use super::model::{Message, MessageKind, MessageMode, Room};
use crate::terminal::AppError;

/// 信封版本。认不出的版本整行跳过——CCCS 规定改信封语义必须升版本。
pub const LEDGER_VERSION: u32 = 1;

#[cfg(test)]
thread_local! { static REPLAY_BYTES: std::cell::Cell<u64> = const { std::cell::Cell::new(0) }; }
#[cfg(test)]
pub(super) fn take_replay_bytes() -> u64 { REPLAY_BYTES.replace(0) }

/// 旧版本的破坏性压缩阈值，仅用于兼容回归；原账本现保留到删除房间。
#[cfg(test)]
pub const COMPACT_AFTER: usize = super::model::MAX_MESSAGES * 3;

pub const CHAT_MESSAGE: &str = "chat.message";
pub const SYSTEM_NOTIFY: &str = "system.notify";
pub const RUNTIME_DELIVERY: &str = "runtime.delivery";
pub const REPLY_CANCELLED: &str = "chat.reply_request.cancelled";
pub const RECIPIENT_WITHDRAWN: &str = "chat.recipient.withdrawn";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LedgerEvent {
    pub v: u32,
    pub id: String,
    pub ts: i64,
    pub kind: String,
    pub room_id: String,
    /// `user`、`system` 或 memberId。
    pub by: String,
    #[serde(default)]
    pub data: Value,
}

#[derive(Default, Serialize, Deserialize)]
struct MessageData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    inbox: Option<belfry_protocol::inbox::MessageSemantics>,
    #[serde(default)]
    text: String,
    #[serde(default)]
    to: Vec<String>,
    #[serde(default)]
    message_mode: MessageMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reply_to: Option<String>,
    /// 附件只记元数据，二进制在 `attachments/` 目录里（CCCS §8 也是只存引用）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<RoomAttachment>,
}

#[derive(Serialize, Deserialize)]
struct DeliveryData {
    actor_id: String,
    source_event_id: String,
    state: String,
    transport: String,
}

#[derive(Serialize, Deserialize)]
struct CancelData {
    source_event_id: String,
}

#[derive(Serialize, Deserialize)]
struct WithdrawRecipientData {
    source_event_id: String,
    member_id: String,
    reason: String,
}

fn event(room_id: &str, id: String, ts: i64, kind: &str, by: &str, data: impl Serialize) -> LedgerEvent {
    LedgerEvent {
        v: LEDGER_VERSION,
        id,
        ts,
        kind: kind.to_string(),
        room_id: room_id.to_string(),
        by: by.to_string(),
        data: serde_json::to_value(data).unwrap_or(Value::Null),
    }
}

pub fn message_event(room_id: &str, message: &Message) -> LedgerEvent {
    let kind = match message.kind {
        MessageKind::Chat => CHAT_MESSAGE,
        MessageKind::Notice => SYSTEM_NOTIFY,
    };
    let data = MessageData {
        inbox: message.inbox.clone(),
        text: message.text.clone(),
        to: message.to.clone(),
        message_mode: message.mode,
        reply_to: message.reply_to.clone(),
        attachments: message.attachments.clone(),
    };
    event(room_id, message.id.clone(), message.at, kind, &message.by, data)
}

pub fn delivery_event(room_id: &str, message_id: &str, member_id: &str, ts: i64) -> LedgerEvent {
    let data = DeliveryData {
        actor_id: member_id.to_string(),
        source_event_id: message_id.to_string(),
        state: "accepted".to_string(),
        transport: "pty".to_string(),
    };
    event(room_id, super::model::new_id(), ts, RUNTIME_DELIVERY, "system", data)
}

pub fn cancel_event(room_id: &str, message_id: &str, by: &str, ts: i64) -> LedgerEvent {
    let data = CancelData { source_event_id: message_id.to_string() };
    event(room_id, super::model::new_id(), ts, REPLY_CANCELLED, by, data)
}

pub fn withdraw_recipient_event(room_id: &str, message_id: &str, member_id: &str, by: &str, ts: i64) -> LedgerEvent {
    let data = WithdrawRecipientData { source_event_id: message_id.into(), member_id: member_id.into(), reason: "Inbox recipient withdrawn before submission".into() };
    event(room_id, super::model::new_id(), ts, RECIPIENT_WITHDRAWN, by, data)
}

/// 把一条事件投影到房间上。幂等：同一批事件重复追加（保存失败后重试）时，
/// 重放结果不变。认不出的 kind 原样忽略。
pub fn apply(room: &mut Room, event: &LedgerEvent) {
    match event.kind.as_str() {
        CHAT_MESSAGE | SYSTEM_NOTIFY => {
            let Ok(data) = MessageData::deserialize(&event.data) else { return };
            if room.all_messages().any(|message| message.id == event.id) {
                return;
            }
            let answers = data.inbox.as_ref().map(|s| s.answers.clone()).unwrap_or_default();
            for original in room.retained_messages.iter_mut().chain(room.messages.iter_mut()) {
                if let Some(semantics) = &mut original.inbox {
                    if data.reply_to.as_deref() == Some(&original.id) || semantics.questions.iter().any(|question| answers.contains(&question.id)) { semantics.revision = semantics.revision.max(1).saturating_add(1); }
                    for question in &mut semantics.questions {
                        let legacy_reply = question.legacy && data.reply_to.as_deref() == Some(&original.id);
                        let same_recipient = if let Some(sender) = &data.inbox { sender.sender_tab.as_ref().is_some_and(|tab| semantics.recipient_tabs.get(&event.by) == Some(tab)) } else { question.legacy };
                        if (answers.contains(&question.id) || legacy_reply) && question.recipients.contains(&event.by) && same_recipient
                            && !question.cancelled_for.contains(&event.by) && !original.reply_cancelled {
                            let replies = question.replies.entry(event.by.clone()).or_default();
                            if !replies.contains(&event.id) { replies.push(event.id.clone()); }
                        }
                    }
                    let applicable: Vec<_> = semantics.questions.iter().filter(|q| q.recipients.contains(&event.by)).collect();
                    if !applicable.is_empty() && applicable.iter().all(|q| q.replies.contains_key(&event.by))
                        && !original.replied_by.contains(&event.by) { original.replied_by.push(event.by.clone()); }
                } else if data.reply_to.as_deref() == Some(&original.id) && original.to.contains(&event.by) && !original.replied_by.contains(&event.by) {
                    original.replied_by.push(event.by.clone());
                }
            }
            super::semantics::remember_operation(room, &event.by, &event.id, &data.to, data.inbox.as_ref());
            room.messages.push(Message {
                inbox: data.inbox,
                id: event.id.clone(),
                at: event.ts,
                kind: if event.kind == SYSTEM_NOTIFY { MessageKind::Notice } else { MessageKind::Chat },
                by: event.by.clone(),
                text: data.text,
                to: data.to,
                mode: data.message_mode,
                reply_to: data.reply_to,
                attachments: data.attachments,
                delivered_to: Vec::new(),
                replied_by: Vec::new(),
                reply_cancelled: false,
            });
        }
        RUNTIME_DELIVERY => {
            let Ok(data) = DeliveryData::deserialize(&event.data) else { return };
            if data.state != "accepted" {
                return;
            }
            if let Some(message) = room.message_mut(&data.source_event_id)
                && !message.delivered_to.contains(&data.actor_id)
            {
                message.delivered_to.push(data.actor_id);
            }
        }
        RECIPIENT_WITHDRAWN => {
            let Ok(data) = WithdrawRecipientData::deserialize(&event.data) else { return; };
            if let Some(message) = room.message_mut(&data.source_event_id) && let Some(semantics) = &mut message.inbox {
                let mut changed = false;
                for question in &mut semantics.questions {
                    if question.recipients.contains(&data.member_id) && !question.replies.contains_key(&data.member_id) && !question.cancelled_for.contains(&data.member_id) {
                        question.cancelled_for.push(data.member_id.clone()); changed = true;
                    }
                }
                if changed { semantics.revision = semantics.revision.max(1).saturating_add(1); }
            }
        }
        REPLY_CANCELLED => {
            let Ok(data) = CancelData::deserialize(&event.data) else { return };
            if let Some(message) = room.message_mut(&data.source_event_id) {
                message.reply_cancelled = true;
                if let Some(semantics) = &mut message.inbox { semantics.revision = semantics.revision.max(1).saturating_add(1); for question in &mut semantics.questions {
                    question.cancelled_for = question.recipients.iter().filter(|id| !question.replies.contains_key(*id)).cloned().collect();
                } }
            }
        }
        _ => {}
    }
    room.trim_messages();
}

pub fn path(root: &Path, room_id: &str) -> Result<PathBuf, AppError> {
    let valid = room_id.len() == 26
        && room_id.bytes().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit());
    if !valid {
        return Err(AppError::invalid_argument("房间编号无效，找不到它的消息账本"));
    }
    Ok(root.join("ledgers").join(format!("{room_id}.jsonl")))
}

/// 读整份账本。不存在是空账本；读不出的行跳过并打日志——写到一半的末行
/// 从没向调用方报过成功，丢掉它不算丢消息。
pub fn length(path: &Path) -> Result<u64, AppError> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(metadata.len()),
        Ok(_) => Err(AppError::io("消息账本不是普通文件")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(AppError::io(error.to_string())),
    }
}

/// 旧存储升级时只保留一行与当前投影；日常启动直接使用 rooms.json 的完整投影快照。
pub fn visit_committed(path: &Path, committed: u64, mut visit: impl FnMut(LedgerEvent)) -> Result<(), AppError> {
    if committed == 0 { return Ok(()); }
    if length(path)? < committed { return Err(AppError::io("消息账本短于已提交游标，已保留现场")); }
    let file = fs::File::open(path).map_err(|error| AppError::io(error.to_string()))?;
    let mut reader = BufReader::new(file.take(committed));
    let mut line = Vec::new();
    let mut oversized = false;
    let mut index = 1;
    loop {
        let buffer = reader.fill_buf().map_err(|error| AppError::io(error.to_string()))?;
        if buffer.is_empty() {
            visit_line(path, index, &line, oversized, &mut visit);
            break;
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let count = newline.map_or(buffer.len(), |at| at + 1);
        let bytes = &buffer[..count];
        // 正常房间消息最多 16K 字符；异常超大行仍逐字保留在账本里，只跳过投影。
        if !oversized && line.len() + bytes.len() <= 4 * 1024 * 1024 { line.extend_from_slice(bytes); }
        else { oversized = true; }
        reader.consume(count);
        #[cfg(test)]
        REPLAY_BYTES.set(REPLAY_BYTES.get() + count as u64);
        if newline.is_some() {
            visit_line(path, index, &line, oversized, &mut visit);
            line.clear();
            oversized = false;
            index += 1;
        }
    }
    Ok(())
}

fn visit_line(path: &Path, index: usize, line: &[u8], oversized: bool, visit: &mut impl FnMut(LedgerEvent)) {
    if oversized {
        log::warn!("Ledger {} line {index} exceeds the projection record limit; raw history retained", path.display());
    } else if !line.iter().all(u8::is_ascii_whitespace) {
        match serde_json::from_slice::<LedgerEvent>(line) {
            Ok(event) if event.v == LEDGER_VERSION => visit(event),
            Ok(event) => log::warn!("Ledger {} line {index}: unsupported version {}; raw history retained", path.display(), event.v),
            Err(error) => log::warn!("Ledger {} line {index}: {error}; raw history retained", path.display()),
        }
    }
}

/// 未提交尾部从来没有成功回执；重试前裁掉，不能把旧失败操作随新提交带进去。
pub fn discard_uncommitted(path: &Path, committed: u64) -> Result<(), AppError> {
    let actual = length(path)?;
    if actual < committed { return Err(AppError::io("消息账本短于已提交游标")); }
    if actual > committed {
        let file = OpenOptions::new().write(true).open(path).map_err(|error| AppError::io(error.to_string()))?;
        file.set_len(committed).and_then(|_| file.sync_data()).map_err(|error| AppError::io(error.to_string()))?;
    }
    Ok(())
}

/// 追加一批事件。末尾缺换行（上次写到一半）时先补换行，原有字节不动（CCCS §4.3）。
pub fn append(path: &Path, events: &[LedgerEvent]) -> Result<(), AppError> {
    if events.is_empty() {
        return Ok(());
    }
    let io = |err: std::io::Error| AppError::io(format!("写不了消息账本 {}：{err}", path.display()));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(io)?;
    }
    let mut file = OpenOptions::new().create(true).read(true).append(true).open(path).map_err(io)?;
    let len = file.metadata().map_err(io)?.len();
    let mut buffer = String::new();
    if len > 0 {
        let mut last = [0u8];
        file.seek(SeekFrom::Start(len - 1)).map_err(io)?;
        file.read_exact(&mut last).map_err(io)?;
        if last[0] != b'\n' {
            buffer.push('\n');
        }
    }
    buffer.push_str(&encode(events)?);
    file.write_all(buffer.as_bytes()).map_err(io)?;
    file.sync_data().map_err(io)
}

fn encode(events: &[LedgerEvent]) -> Result<String, AppError> {
    let mut text = String::new();
    for event in events {
        let line = serde_json::to_string(event)
            .map_err(|error| AppError::io(format!("消息事件序列化失败：{error}")))?;
        text.push_str(&line);
        text.push('\n');
    }
    Ok(text)
}
