//! 查 npm registry 的 `latest` 版本。
//!
//! 端点 `https://registry.npmjs.org/-/package/<pkg>/dist-tags` 只回几十字节，
//! scoped 包名无需 URL 编码。复用 `provider::models` 的 reqwest 范式。

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde_json::Value;

const TIMEOUT_SECONDS: u64 = 15;
/// dist-tags 响应极小，给足余量即可。
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const DIST_TAGS: &str = "https://registry.npmjs.org/-/package";

/// 返回包的最新版本。
///
/// - `Ok(Some(version))`：正常拿到。
/// - `Ok(None)`：registry 上没有这个包（404），调用方给「未发布」提示。
/// - `Err(message)`：网络或格式问题，调用方落到 `Unknown` 并把原因带给用户。
pub(crate) async fn latest(package: &str) -> Result<Option<String>, String> {
    validate_package_name(package)?;
    // 与应用更新器共用 ring；registry 请求可能早于更新器初始化。
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECONDS))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法创建 registry 请求".to_string())?;
    let url = format!("{DIST_TAGS}/{package}/dist-tags");
    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "查询 npm registry 超时，请检查网络后重试"
            } else {
                "无法连接 npm registry，请检查网络"
            }
        })?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("npm registry 返回 HTTP {}", response.status().as_u16()));
    }
    let bytes = read_body(response).await?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "npm registry 未返回有效的 JSON")?;
    let latest = value
        .get("latest")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|version| !version.is_empty());
    match latest {
        Some(version) => Ok(Some(version.to_string())),
        None => Err("npm registry 未返回 latest 版本号".to_string()),
    }
}

/// 校验包名字符集，避免拼进 URL 时产生注入。合法字符取 npm 包名规范的超集。
fn validate_package_name(package: &str) -> Result<(), String> {
    let trimmed = package.trim();
    if trimmed.is_empty() || trimmed.len() > 214 {
        return Err("包名为空或过长".to_string());
    }
    if !trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'@' | b'/' | b'-' | b'_' | b'~'))
    {
        return Err("包名包含非法字符".to_string());
    }
    Ok(())
}

async fn read_body(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取 npm registry 响应失败")? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("npm registry 响应过大".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_scoped_and_unscoped_names() {
        assert!(validate_package_name("@cometix/claude-code").is_ok());
        assert!(validate_package_name("@openai/codex").is_ok());
        assert!(validate_package_name("pi").is_ok());
    }

    #[test]
    fn rejects_names_that_could_inject_into_urls() {
        assert!(validate_package_name("").is_err());
        assert!(validate_package_name("@scope/name?x=1").is_err());
        assert!(validate_package_name("../escape").is_err());
        assert!(validate_package_name("@scope/name&other").is_err());
    }

    #[test]
    fn latest_field_parsing() {
        let value: Value = serde_json::from_str(r#"{"latest":"2.1.263","beta":"2.2.0-beta.1"}"#).unwrap();
        assert_eq!(value.get("latest").and_then(Value::as_str), Some("2.1.263"));
    }
}
