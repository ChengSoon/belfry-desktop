use serde::Serialize;

/// 一张已导入的背景图。字节本身不走这里，由 `background_read` 单独取。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundAsset {
    /// 应用数据目录下的文件名，形如 `background.png`。
    pub file_name: String,
    /// 前端拼 Blob 用。让后端给而不是让前端从扩展名猜，嗅探结果才是权威的。
    pub mime: String,
    pub byte_size: u64,
}
