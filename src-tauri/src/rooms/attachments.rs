//! 附件保存为房间自己的副本（`rooms/attachments/<roomId>/<attachmentId>/files/<文件名>`）；
//! 消息只存元数据，二进制不进账本也不进 rooms.json。

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::model::new_id;
use super::store::RoomStore;
use crate::atomic::write_atomic;
use crate::terminal::AppError;

pub const MAX_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_ATTACHMENTS: usize = 10;

fn canonicalize(path: &Path) -> Result<PathBuf, AppError> {
    crate::resource::canonicalize(path)
        .map_err(|err| AppError::io(format!("附件路径不可用：{err}")))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoomAttachment {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub mime_type: String,
}

pub(super) fn valid_id(id: &str) -> bool {
    id.len() == 26
        && id
            .bytes()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
}

/// 一间房的附件目录。`root` 是房间存储根（`<应用数据>/rooms`）。
pub(super) fn room_directory(root: &Path, room_id: &str) -> Result<PathBuf, AppError> {
    if !valid_id(room_id) {
        return Err(AppError::invalid_argument("附件的房间编号无效"));
    }
    Ok(root.join("attachments").join(room_id))
}

fn attachment_directory(root: &Path, id: &str) -> Result<PathBuf, AppError> {
    if !valid_id(id) {
        return Err(AppError::invalid_argument("附件编号无效"));
    }
    Ok(root.join(id))
}

fn safe_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let name: String = base
        .chars()
        .take(160)
        .map(|ch| {
            if ch.is_control() || "<>:\"|?*".contains(ch) {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let name = name.trim().trim_matches('.').trim();
    if name.is_empty() {
        return "附件".into();
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix)
                .is_some_and(|tail| tail.len() == 1 && matches!(tail.as_bytes()[0], b'1'..=b'9'))
        })
    {
        format!("附件-{name}")
    } else {
        name.to_string()
    }
}

fn mime_type(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "txt" | "md" | "csv" | "json" | "log" => "text/plain",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

pub fn import_path(
    store: &RoomStore,
    room_id: &str,
    source: &str,
) -> Result<RoomAttachment, AppError> {
    let path = Path::new(source);
    let metadata =
        fs::metadata(path).map_err(|err| AppError::io(format!("读不了附件信息：{err}")))?;
    if !metadata.is_file() {
        return Err(AppError::invalid_argument(
            "暂不支持文件夹，请选择图片或文档文件",
        ));
    }
    if metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err(AppError::invalid_argument("单个附件不能超过 20 MB"));
    }
    let file = File::open(path).map_err(|err| AppError::io(format!("读不了附件：{err}")))?;
    let mut bytes = Vec::new();
    file.take(MAX_ATTACHMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| AppError::io(format!("读不了附件：{err}")))?;
    import_bytes(
        store,
        room_id,
        &path.file_name().unwrap_or_default().to_string_lossy(),
        &bytes,
    )
}

pub fn import_bytes(
    store: &RoomStore,
    room_id: &str,
    name: &str,
    bytes: &[u8],
) -> Result<RoomAttachment, AppError> {
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(AppError::invalid_argument("单个附件不能超过 20 MB"));
    }
    let root = store.attachment_directory(room_id)?;
    fs::create_dir_all(&root).map_err(|err| AppError::io(format!("建不了附件目录：{err}")))?;
    let id = new_id();
    let dir = attachment_directory(&root, &id)?;
    fs::create_dir(&dir).map_err(|err| AppError::io(format!("建不了附件目录：{err}")))?;
    let result = (|| {
        let name = safe_name(name);
        // 加一层 files，避免用户文件名与我们的 metadata.json 撞名。
        let files = dir.join("files");
        fs::create_dir(&files).map_err(|err| AppError::io(format!("建不了附件目录：{err}")))?;
        let path = files.join(&name);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|err| AppError::io(format!("保存附件失败：{err}")))?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|err| AppError::io(format!("保存附件失败：{err}")))?;
        let attachment = RoomAttachment {
            id,
            mime_type: mime_type(&name).into(),
            name,
            path: canonicalize(&path)?.to_string_lossy().into_owned(),
            size: bytes.len() as u64,
        };
        let json =
            serde_json::to_string(&attachment).map_err(|err| AppError::io(err.to_string()))?;
        write_atomic(&dir.join("metadata.json"), &json, false)?;
        Ok(attachment)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    result
}

pub fn resolve(
    store: &RoomStore,
    room_id: &str,
    ids: &[String],
) -> Result<Vec<RoomAttachment>, AppError> {
    if ids.len() > MAX_ATTACHMENTS {
        return Err(AppError::invalid_argument("每条消息最多添加 10 个附件"));
    }
    let mut unique = HashSet::new();
    // 无附件时不要碰磁盘，也不改变旧消息命令的行为。
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let root = store.attachment_directory(room_id)?;
    ids.iter()
        .map(|id| {
            if !unique.insert(id) {
                return Err(AppError::invalid_argument("同一个附件被添加了两次"));
            }
            let dir = attachment_directory(&root, id)?;
            let file = File::open(dir.join("metadata.json"))
                .map_err(|_| AppError::not_found("附件已不存在，请重新添加"))?;
            let attachment: RoomAttachment = serde_json::from_reader(file.take(16 * 1024))
                .map_err(|_| AppError::invalid_argument("附件信息损坏，请重新添加"))?;
            let expected = dir.join("files").join(safe_name(&attachment.name));
            let canonical = canonicalize(&expected)?;
            let canonical_root = canonicalize(&root)?;
            if attachment.id != *id
                || attachment.name != safe_name(&attachment.name)
                || canonical.to_string_lossy() != attachment.path
                || !canonical.starts_with(canonical_root)
            {
                return Err(AppError::invalid_argument("附件路径无效，请重新添加"));
            }
            validate_existing(std::slice::from_ref(&attachment))?;
            Ok(attachment)
        })
        .collect()
}

/// 在写入消息的锁内复查，避免丢弃草稿与发送并发时留下失效引用。
pub(super) fn validate_existing(attachments: &[RoomAttachment]) -> Result<(), AppError> {
    for attachment in attachments {
        let meta = fs::metadata(&attachment.path).map_err(|_| {
            AppError::not_found(format!("附件「{}」已不存在，请重新添加", attachment.name))
        })?;
        if !meta.is_file() || meta.len() != attachment.size || meta.len() > MAX_ATTACHMENT_BYTES {
            return Err(AppError::invalid_argument(format!(
                "附件「{}」已改变，请重新添加",
                attachment.name
            )));
        }
    }
    Ok(())
}

pub(super) fn discard(root: &Path, id: &str) -> Result<(), AppError> {
    match fs::remove_dir_all(attachment_directory(root, id)?) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AppError::io(format!("移除附件失败：{err}"))),
    }
}

/// 正文加附件清单：送进成员终端、成员读 `room log` 都用它。
/// 点名只解析正文，文件名里的 @ 不参与收件人选择。
pub fn instruction(text: &str, attachments: &[RoomAttachment]) -> String {
    if attachments.is_empty() {
        return text.to_string();
    }
    let mut parts = Vec::new();
    if !text.is_empty() {
        parts.push(text.to_string());
    }
    let mut files = String::from("附件（本地文件，请按需读取）：");
    for attachment in attachments {
        files.push_str(&format!("\n- {}\n  {}", attachment.name, attachment.path));
    }
    parts.push(files);
    parts.join("\n\n")
}

/// 一句话摘要：有正文用正文，只有附件时列出文件名。引用回复的摘录用它。
pub fn summary(text: &str, attachments: &[RoomAttachment]) -> String {
    if !text.trim().is_empty() || attachments.is_empty() {
        return text.to_string();
    }
    let names: Vec<&str> = attachments.iter().map(|attachment| attachment.name.as_str()).collect();
    format!("[附件] {}", names.join("、"))
}

#[cfg(test)]
#[path = "attachments_test.rs"]
mod tests;
