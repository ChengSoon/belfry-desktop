use std::{collections::BTreeSet, time::Duration};
use reqwest::{Client, StatusCode, Url};
use serde_json::Value;
use crate::{agent::AgentKind, terminal::AppError};

const TIMEOUT_SECONDS: u64 = 15;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PAGES: usize = 10;

fn endpoints(base: &str) -> Result<Vec<Url>, AppError> {
    let mut url = Url::parse(base.trim()).map_err(|_| AppError::invalid_argument("请填写有效的 Base URL"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err(AppError::invalid_argument("Base URL 需为 HTTP/HTTPS 地址，不能包含账号、查询参数或片段"));
    }
    let path = url.path().trim_end_matches('/').to_string();
    if path.ends_with("/models") { return Ok(vec![url]); }
    if path.ends_with("/v1") { url.set_path(&format!("{path}/models")); return Ok(vec![url]); }
    url.set_path(&format!("{path}/v1/models"));
    let mut fallback = url.clone();
    fallback.set_path(&format!("{path}/models"));
    Ok(vec![url, fallback])
}

pub async fn fetch(kind: AgentKind, base: &str, key: &str) -> Result<Vec<String>, AppError> {
    let urls = endpoints(base)?;
    // 与应用更新器共用 ring；模型请求可能早于更新器初始化。
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = Client::builder().timeout(Duration::from_secs(TIMEOUT_SECONDS))
        .redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|_| AppError::io("无法创建模型请求"))?;
    for (index, url) in urls.iter().enumerate() {
        let response = request(&client, kind, url.clone(), key).await?;
        if matches!(response.status(), StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED)
            && index + 1 < urls.len() { continue; }
        return collect(&client, kind, url.clone(), key, response).await;
    }
    Err(AppError::unsupported("该服务未提供模型列表，请手动填写模型 ID"))
}

async fn request(client: &Client, kind: AgentKind, url: Url, key: &str) -> Result<reqwest::Response, AppError> {
    let mut request = client.get(url).header("Accept", "application/json");
    if !key.trim().is_empty() { request = request.bearer_auth(key.trim()); }
    if kind == AgentKind::Claude {
        request = request.header("anthropic-version", "2023-06-01");
        if !key.trim().is_empty() { request = request.header("x-api-key", key.trim()); }
    }
    request.send().await.map_err(|error| {
        if error.is_timeout() { AppError::timeout("获取模型超时，请稍后重试") }
        else { AppError::io("无法连接模型服务，请检查地址、网络和密钥格式") }
    })
}

async fn read_json(mut response: reqwest::Response) -> Result<Value, AppError> {
    let status = response.status();
    if !status.is_success() {
        let message = match status.as_u16() {
            401 | 403 => "认证失败，请检查 API Key 与访问权限".into(),
            404 | 405 => "该端点未提供模型列表，请手动填写模型 ID".into(),
            429 => "请求过于频繁，请稍后重试".into(),
            _ => format!("模型服务返回 HTTP {}，请检查端点后重试", status.as_u16()),
        };
        return Err(AppError::io(message));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| AppError::io("读取模型列表失败"))? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES { return Err(AppError::io("模型列表响应过大")); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| AppError::io("服务未返回有效的 JSON 模型列表，请检查 Base URL"))
}

fn parse_ids(value: &Value) -> Result<Vec<String>, AppError> {
    let data = value.get("data").and_then(Value::as_array)
        .ok_or_else(|| AppError::io("服务返回了不支持的模型列表格式，请手动填写模型 ID"))?;
    Ok(data.iter().filter_map(|model| model.get("id").and_then(Value::as_str))
        .map(str::trim).filter(|id| !id.is_empty()).map(str::to_owned).collect())
}

async fn collect(client: &Client, kind: AgentKind, mut url: Url, key: &str, first: reqwest::Response) -> Result<Vec<String>, AppError> {
    let mut value = read_json(first).await?;
    let mut ids = BTreeSet::new();
    let mut cursors = BTreeSet::new();
    for page in 0..MAX_PAGES {
        ids.extend(parse_ids(&value)?);
        if value.get("has_more").and_then(Value::as_bool) != Some(true) { return Ok(ids.into_iter().collect()); }
        let cursor = value.get("last_id").and_then(Value::as_str).filter(|id| !id.is_empty())
            .ok_or_else(|| AppError::io("模型列表缺少分页信息，请手动填写模型 ID"))?;
        if !cursors.insert(cursor.to_owned()) || page + 1 == MAX_PAGES {
            return Err(AppError::io("模型列表分页过多或重复，请手动填写模型 ID"));
        }
        url.set_query(None);
        url.query_pairs_mut().append_pair("after_id", cursor);
        value = read_json(request(client, kind, url.clone(), key).await?).await?;
    }
    unreachable!()
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;
