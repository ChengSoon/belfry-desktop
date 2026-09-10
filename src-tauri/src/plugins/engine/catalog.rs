use super::connection::Connection;
use crate::plugins::pi_manifest::MAX_THEME_BYTES;
use serde_json::{Value, json};

// 主题文件逐个传输，避免多个合法 CSS 合并后超过宿主的单消息上限。
pub fn read(connection: &Connection) -> Result<Value, String> {
    let mut catalog = connection.call("catalog", json!({"themeContents":false}))?;
    let themes = catalog["themes"].as_array_mut().ok_or("主题目录格式无效")?;
    for theme in themes {
        let css = connection.call("theme", theme.clone())?;
        let text = css.as_str().ok_or("主题内容格式无效")?;
        // Node 端先核对 cssDigest 与当前插件快照，Rust 保持相同的单主题容量限制。
        if text.len() > MAX_THEME_BYTES {
            return Err("主题 CSS 超过 256 KiB".into());
        }
        theme["css"] = css;
    }
    Ok(catalog)
}
