use serde::Serialize;

/// 一份已复制进应用数据目录的用户字体。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFontAsset {
    pub file_name: String,
    pub display_name: String,
    pub mime: String,
    pub byte_size: u64,
}
