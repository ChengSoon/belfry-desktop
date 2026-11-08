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
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::attachments::RoomAttachment;
use super::model::{Message, MessageKind, MessageMode, Room, MAX_MESSAGES};
use crate::atomic::write_atomic;
use crate::terminal::AppError;

/// 信封版本。认不出的版本整行跳过——CCCS 规定改信封语义必须升版本。
pub const LEDGER_VERSION: u32 = 1;

/// 账本事件多于这么多条时，启动时按投影压缩一次。投影最多 MAX_MESSAGES 条消息，
/// 每条再带几笔送达，三倍的余量让压缩不会每次启动都发生。
pub const COMPACT_AFTER: usize = MAX_MESSAGES * 3;

pub const CHAT_MESSAGE: &str = "chat.message";
pub const SYSTEM_NOTIFY: &str = "system.notify";
pub const RUNTIME_DELIVERY: &str = "runtime.delivery";
pub const REPLY_CANCELLED: &str = "chat.reply_request.cancelled";

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

/// 把一条事件投影到房间上。幂等：同一批事件重复追加（保存失败后重试）时，
/// 重放结果不变。认不出的 kind 原样忽略。
pub fn apply(room: &mut Room, event: &LedgerEvent) {
    match event.kind.as_str() {
        CHAT_MESSAGE | SYSTEM_NOTIFY => {
            let Ok(data) = MessageData::deserialize(&event.data) else { return };
            if room.messages.iter().any(|message| message.id == event.id) {
                return;
            }
            // 带 reply_to 的回复了结发件人在原消息上的回复义务（CCCS §6.1）。
            if let Some(target) = &data.reply_to
                && let Some(original) = room.messages.iter_mut().find(|message| &message.id == target)
                && original.to.contains(&event.by)
                && !original.replied_by.contains(&event.by)
            {
                original.replied_by.push(event.by.clone());
            }
            room.messages.push(Message {
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
            if room.messages.len() > MAX_MESSAGES {
                let overflow = room.messages.len() - MAX_MESSAGES;
                room.messages.drain(..overflow);
            }
        }
        RUNTIME_DELIVERY => {
            let Ok(data) = DeliveryData::deserialize(&event.data) else { return };
            if data.state != "accepted" {
                return;
            }
            if let Some(message) = room.messages.iter_mut().find(|m| m.id == data.source_event_id)
                && !message.delivered_to.contains(&data.actor_id)
            {
                message.delivered_to.push(data.actor_id);
            }
        }
        REPLY_CANCELLED => {
            let Ok(data) = CancelData::deserialize(&event.data) else { return };
            if let Some(message) = room.messages.iter_mut().find(|m| m.id == data.source_event_id) {
                message.reply_cancelled = true;
            }
        }
        _ => {}
    }
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
pub fn read(path: &Path) -> Result<Vec<LedgerEvent>, AppError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(AppError::io(format!("读不了 {}：{err}", path.display()))),
    };
    let mut events = Vec::new();
    for (index, line) in bytes.split(|byte| *byte == b'\n').enumerate() {
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice::<LedgerEvent>(line) {
            Ok(event) if event.v == LEDGER_VERSION => events.push(event),
            Ok(event) => eprintln!(
                "[belfry] 房间账本 {} 第 {} 行是信封版本 {}，不认识，已跳过",
                path.display(), index + 1, event.v
            ),
            Err(error) => eprintln!(
                "[belfry] 房间账本 {} 第 {} 行读不出来，已跳过：{error}",
                path.display(), index + 1
            ),
        }
    }
    Ok(events)
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

/// 用一组事件整份替换账本（原子替换：写到一半崩溃不会留下半份账本）。
pub fn rewrite(path: &Path, events: &[LedgerEvent]) -> Result<(), AppError> {
    write_atomic(path, &encode(events)?, false)
}

/// 按当前投影重新生成最少的事件：每条消息、它的送达、撤销的回复请求。
/// 回复关系由回复消息本身的 `reply_to` 重放出来，不用单独记。重放结果与投影一致。
pub fn snapshot(room: &Room) -> Vec<LedgerEvent> {
    let mut events = Vec::new();
    for message in &room.messages {
        events.push(message_event(&room.id, message));
        for member_id in &message.delivered_to {
            events.push(delivery_event(&room.id, &message.id, member_id, message.at));
        }
        if message.reply_cancelled {
            events.push(cancel_event(&room.id, &message.id, "user", message.at));
        }
    }
    events
}
