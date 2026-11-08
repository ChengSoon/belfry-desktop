//! 附件的 Tauri 命令：选择、导入（路径或粘贴的二进制）、读取预览、丢弃草稿、在文件夹中显示。

use std::io::Read;
use std::sync::Arc;

use serde::Deserialize;
use tauri::{
    State,
    ipc::{InvokeBody, Request, Response},
};
use tauri_plugin_dialog::DialogExt;

use super::{
    RoomStore,
    attachments::{self, RoomAttachment},
};
use crate::terminal::AppError;

#[tauri::command]
pub async fn room_pick_attachments(window: tauri::WebviewWindow) -> Result<Vec<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(belfry_i18n::text("添加图片或文档"))
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|file| {
                file.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|err| AppError::io(err.to_string()))
            })
            .collect()
    })
    .await
    .map_err(|err| AppError::io(err.to_string()))?
}

#[tauri::command]
pub async fn room_import_attachment(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    source: String,
) -> Result<RoomAttachment, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || attachments::import_path(&store, &id, &source))
        .await
        .map_err(|err| AppError::io(err.to_string()))?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasteMetadata {
    room_id: String,
    name: String,
}

/// 原始二进制 IPC，避免将 20 MB 的图片膨胀为 JSON 数字数组。
#[tauri::command]
pub async fn room_paste_attachment(
    store: State<'_, Arc<RoomStore>>,
    request: Request<'_>,
) -> Result<RoomAttachment, AppError> {
    let metadata: PasteMetadata = request
        .headers()
        .get("x-room-attachment")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| serde_json::from_str(value).ok())
        .ok_or_else(|| AppError::invalid_argument("附件信息不完整"))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::invalid_argument("附件内容不是二进制数据"));
    };
    if bytes.len() as u64 > attachments::MAX_ATTACHMENT_BYTES {
        return Err(AppError::invalid_argument("单个附件不能超过 20 MB"));
    }
    let bytes = bytes.clone();
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        attachments::import_bytes(&store, &metadata.room_id, &metadata.name, &bytes)
    })
    .await
    .map_err(|err| AppError::io(err.to_string()))?
}

#[tauri::command]
pub async fn room_read_attachment(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    attachment_id: String,
) -> Result<Response, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let attachment = attachments::resolve(&store, &id, &[attachment_id])?.remove(0);
        let file =
            std::fs::File::open(&attachment.path).map_err(|err| AppError::io(err.to_string()))?;
        let mut bytes = Vec::new();
        file.take(attachments::MAX_ATTACHMENT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|err| AppError::io(err.to_string()))?;
        if bytes.len() as u64 > attachments::MAX_ATTACHMENT_BYTES {
            return Err(AppError::invalid_argument("附件超过 20 MB"));
        }
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|err| AppError::io(err.to_string()))?
}

#[tauri::command]
pub fn room_discard_attachment(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    attachment_id: String,
) -> Result<(), AppError> {
    store.discard_attachment(&id, &attachment_id)
}

#[tauri::command]
pub fn room_reveal_attachment(
    store: State<'_, Arc<RoomStore>>,
    id: String,
    attachment_id: String,
) -> Result<(), AppError> {
    let attachment = attachments::resolve(&store, &id, &[attachment_id])?.remove(0);
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("/usr/bin/open");
        command.args(["-R", "--", &attachment.path]);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer.exe");
        command.arg("/select,").arg(&attachment.path);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(std::path::Path::new(&attachment.path).parent().unwrap());
        command
    };
    command
        .spawn()
        .map_err(|err| AppError::io(format!("打不开附件目录：{err}")))?;
    Ok(())
}

#[tauri::command]
pub fn room_clipboard_files() -> Result<Vec<String>, AppError> {
    super::clipboard_files::read()
}
