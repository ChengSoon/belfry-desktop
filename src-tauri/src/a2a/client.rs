use std::{collections::HashSet, time::Duration};

use base64::Engine;
use reqwest::{
    Client, RequestBuilder, Response, Url,
    header::{HeaderName, HeaderValue},
};
use serde_json::{Value, json};

use super::{
    contracts::AgentInterface,
    errors::{error, invalid_response},
    store::Resolved,
    validation,
};
use crate::terminal::AppError;

const MAX_RESPONSE: usize = 2 * 1024 * 1024;

pub(super) struct HttpClient {
    // Local gateway credentials must never be sent to an environment-configured
    // proxy. External endpoints keep the system proxy behavior.
    direct: Client,
    proxied: Client,
    timeout: Duration,
}

pub(super) struct Task {
    pub raw: Value,
    pub id: String,
    pub context_id: Option<String>,
    pub terminal: bool,
}

pub(super) enum SendResult {
    Task(Task),
    Message(Value),
}

impl HttpClient {
    pub(super) fn with_timeout(timeout: Duration) -> Result<Self, AppError> {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let build = |no_proxy: bool| {
            let mut builder = Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5))
                .timeout(timeout)
                .user_agent("Belfry A2A/1.0");
            if no_proxy {
                builder = builder.no_proxy();
            }
            builder.build().map_err(|_| {
                error(
                    "A2A_HTTP_UNAVAILABLE",
                    "The A2A HTTP client could not be initialized.",
                )
            })
        };
        Ok(Self {
            direct: build(true)?,
            proxied: build(false)?,
            timeout,
        })
    }

    fn client(&self, url: &Url) -> &Client {
        if validation::loopback(url) {
            &self.direct
        } else {
            &self.proxied
        }
    }

    pub(super) async fn card(&self, connection: &Resolved) -> Result<Value, AppError> {
        let url = validation::url(&connection.info.card_url)?;
        let request = self
            .client(&url)
            .get(url.clone())
            .timeout(self.timeout.min(Duration::from_secs(10)))
            .header("Accept", "application/json")
            .header("A2A-Version", "1.0");
        // An explicitly chosen cross-origin RPC endpoint never authorizes sending its
        // credential to the card origin. A public card can still be fetched anonymously.
        let request = if validation::origin(&url) == connection.credential_origin {
            authenticated(request, connection)?
        } else {
            request
        };
        let response = request.send().await.map_err(|err| transport(&err, false))?;
        parse(response, false).await
    }

    pub(super) async fn rpc(
        &self,
        connection: &Resolved,
        interface: &AgentInterface,
        method: &str,
        mut params: Value,
    ) -> Result<Value, AppError> {
        let url = validation::url(&interface.url)?;
        if interface.protocol_binding != "JSONRPC" || interface.protocol_version != "1.0" {
            return Err(error(
                "A2A_NO_COMPATIBLE_INTERFACE",
                "Only the A2A JSONRPC / 1.0 interface is implemented.",
            ));
        }
        if connection.secret.is_some() && validation::origin(&url) != connection.credential_origin {
            return Err(error(
                "A2A_CREDENTIAL_ORIGIN_MISMATCH",
                "The RPC endpoint is outside the configured credential origin.",
            ));
        }
        let object = params.as_object_mut().ok_or_else(invalid_response)?;
        if let Some(tenant) = &interface.tenant {
            object.insert("tenant".into(), json!(tenant));
        }
        let id = ulid::Ulid::generate().to_string();
        let body = serde_json::to_vec(
            &json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}),
        )
        .map_err(|_| invalid_response())?;
        let request = authenticated(
            self.client(&url)
                .post(url)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("A2A-Version", "1.0")
                .body(body),
            connection,
        )?;
        let sending = method == "SendMessage";
        let response = request
            .send()
            .await
            .map_err(|err| transport(&err, sending))?;
        let reply = parse(response, sending).await?;
        if !reply.is_object()
            || reply["jsonrpc"] != "2.0"
            || reply["id"] != id
            || reply.get("result").is_some() == reply.get("error").is_some()
        {
            return Err(invalid_response());
        }
        if let Some(failure) = reply.get("error") {
            let code = failure
                .get("code")
                .and_then(Value::as_i64)
                .ok_or_else(invalid_response)?;
            if !failure.is_object() || failure.get("message").and_then(Value::as_str).is_none() {
                return Err(invalid_response());
            }
            let mut value = if code == -32002 {
                error(
                    "A2A_TASK_NOT_CANCELABLE",
                    "The remote agent reports that this task cannot be canceled.",
                )
            } else if code == -32001 {
                error(
                    "A2A_REMOTE_TASK_NOT_FOUND",
                    "The remote agent could not find this task.",
                )
            } else {
                error(
                    "A2A_RPC_ERROR",
                    "The remote agent returned a JSON-RPC error.",
                )
            };
            // A parsed JSON-RPC error response is a definite outcome: the remote
            // received the request and rejected it. Never echo the remote error
            // body: it may reflect Authorization or a secret.
            value.details = Some(json!({"rpcCode":code, "outcomeUnknown":false}));
            return Err(value);
        }
        Ok(reply["result"].clone())
    }
}

fn authenticated(
    request: RequestBuilder,
    connection: &Resolved,
) -> Result<RequestBuilder, AppError> {
    use super::contracts::AuthKind;
    match connection.info.auth.kind {
        AuthKind::None => Ok(request),
        AuthKind::Bearer | AuthKind::ApiKey => {
            let secret = connection.secret.as_ref().ok_or_else(|| {
                error(
                    "A2A_AUTHENTICATION_REQUIRED",
                    "This connection's credential is not configured.",
                )
            })?;
            let (name, mut value) = match connection.info.auth.kind {
                AuthKind::Bearer => (
                    HeaderName::from_static("authorization"),
                    HeaderValue::from_str(&format!("Bearer {}", secret.as_str())),
                ),
                _ => {
                    let name = connection
                        .info
                        .auth
                        .header_name
                        .as_deref()
                        .ok_or_else(invalid_response)?;
                    (
                        HeaderName::from_bytes(name.as_bytes()).map_err(|_| invalid_response())?,
                        HeaderValue::from_str(secret),
                    )
                }
            };
            let value = value.as_mut().map_err(|_| {
                error(
                    "A2A_CREDENTIAL_INVALID",
                    "The credential cannot be used as an HTTP header.",
                )
            })?;
            value.set_sensitive(true);
            Ok(request.header(name, value.clone()))
        }
    }
}

fn transport(err: &reqwest::Error, sending: bool) -> AppError {
    let mut value = if err.is_timeout() {
        error("A2A_TIMEOUT", "The A2A request timed out.")
    } else {
        error(
            "A2A_NETWORK_ERROR",
            "The A2A request could not reach or read the configured agent.",
        )
    };
    value.retryable = !sending;
    if sending {
        value.details = Some(json!({"outcomeUnknown":true}));
    }
    value
}

async fn parse(mut response: Response, sending: bool) -> Result<Value, AppError> {
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        let mut value = error(
            "A2A_HTTP_AUTHENTICATION_REQUIRED",
            "The configured agent rejected authentication or access.",
        );
        // The request was rejected before any task could be accepted.
        value.details = Some(json!({"httpStatus":status.as_u16(), "outcomeUnknown":false}));
        return Err(value);
    }
    if !status.is_success() {
        let mut value = if status.is_redirection() {
            error(
                "A2A_REDIRECT_REJECTED",
                "A2A redirects are not followed. Configure the final trusted URL explicitly.",
            )
        } else {
            error(
                "A2A_HTTP_ERROR",
                "The configured agent returned an unsuccessful HTTP status.",
            )
        };
        value.details = Some(
            json!({"httpStatus":status.as_u16(), "outcomeUnknown":sending && status.is_server_error()}),
        );
        return Err(value);
    }
    if response
        .headers()
        .get("A2A-Version")
        .is_some_and(|header| header.to_str().ok() != Some("1.0"))
    {
        return Err(error(
            "A2A_VERSION_UNSUPPORTED",
            "The remote response declares a different A2A protocol version.",
        ));
    }
    let mime = response
        .headers()
        .get("Content-Type")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim);
    if mime.is_none_or(|mime| !mime.eq_ignore_ascii_case("application/json")) {
        return Err(error(
            "A2A_RESPONSE_TYPE_UNSUPPORTED",
            "The A2A JSON-RPC client expects an application/json response, not a stream or another binding.",
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err(error(
            "A2A_RESPONSE_LIMIT",
            "The A2A response exceeds the 2 MiB limit.",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| transport(&err, sending))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err(error(
                "A2A_RESPONSE_LIMIT",
                "The A2A response exceeds the 2 MiB limit.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid_response())
}

pub(super) fn send_result(value: Value) -> Result<SendResult, AppError> {
    if !value.is_object() || value.get("task").is_some() == value.get("message").is_some() {
        return Err(invalid_response());
    }
    if let Some(task) = value.get("task") {
        Ok(SendResult::Task(task_result(task.clone())?))
    } else {
        let message = value["message"].clone();
        message_shape(&message)?;
        if message["role"] != "ROLE_AGENT" {
            return Err(invalid_response());
        }
        Ok(SendResult::Message(message))
    }
}

pub(super) fn task_result(raw: Value) -> Result<Task, AppError> {
    if !raw.is_object() {
        return Err(invalid_response());
    }
    let id = validation::string(&raw, "id", 512)
        .ok_or_else(invalid_response)?
        .to_owned();
    let status = raw
        .get("status")
        .filter(|value| value.is_object())
        .ok_or_else(invalid_response)?;
    let state = validation::string(status, "state", 128).ok_or_else(invalid_response)?;
    if let Some(message) = status.get("message") {
        message_shape(message)?;
    }
    optional_string(status, "timestamp", 128)?;
    let context_id = optional_string(&raw, "contextId", 512)?.map(str::to_owned);
    if let Some(history) = raw.get("history") {
        for message in bounded_array(history, 256)? {
            message_shape(message)?;
        }
    }
    if let Some(artifacts) = raw.get("artifacts") {
        let mut ids = HashSet::new();
        for artifact in bounded_array(artifacts, 256)? {
            let id =
                validation::string(artifact, "artifactId", 512).ok_or_else(invalid_response)?;
            if !artifact.is_object() || !ids.insert(id) {
                return Err(invalid_response());
            }
            parts(artifact.get("parts").ok_or_else(invalid_response)?)?;
            metadata(artifact)?;
        }
    }
    metadata(&raw)?;
    let terminal = matches!(
        state,
        "TASK_STATE_COMPLETED"
            | "TASK_STATE_FAILED"
            | "TASK_STATE_CANCELED"
            | "TASK_STATE_REJECTED"
    );
    Ok(Task {
        raw,
        id,
        context_id,
        terminal,
    })
}

fn message_shape(value: &Value) -> Result<(), AppError> {
    if !value.is_object()
        || validation::string(value, "messageId", 512).is_none()
        || !matches!(value["role"].as_str(), Some("ROLE_USER" | "ROLE_AGENT"))
    {
        return Err(invalid_response());
    }
    optional_string(value, "contextId", 512)?;
    optional_string(value, "taskId", 512)?;
    parts(value.get("parts").ok_or_else(invalid_response)?)?;
    metadata(value)
}

fn parts(value: &Value) -> Result<(), AppError> {
    let parts = bounded_array(value, 1024)?;
    if parts.is_empty() {
        return Err(invalid_response());
    }
    for part in parts {
        if !part.is_object()
            || ["text", "raw", "url", "data"]
                .iter()
                .filter(|key| part.get(**key).is_some())
                .count()
                != 1
        {
            return Err(invalid_response());
        }
        if part.get("text").is_some_and(|value| !value.is_string()) {
            return Err(invalid_response());
        }
        if let Some(raw) = part.get("raw") {
            let raw = raw.as_str().ok_or_else(invalid_response)?;
            base64::engine::general_purpose::STANDARD
                .decode(raw)
                .map_err(|_| invalid_response())?;
        }
        if let Some(url) = part.get("url") {
            let url = url
                .as_str()
                .filter(|s| s.len() <= 4096)
                .ok_or_else(invalid_response)?;
            reqwest::Url::parse(url).map_err(|_| invalid_response())?;
            // URL and raw parts are retained as data, never fetched or opened.
        }
        optional_string(part, "filename", 1024)?;
        optional_string(part, "mediaType", 256)?;
        metadata(part)?;
    }
    Ok(())
}

fn bounded_array(value: &Value, max: usize) -> Result<&Vec<Value>, AppError> {
    value
        .as_array()
        .filter(|items| items.len() <= max)
        .ok_or_else(invalid_response)
}
fn optional_string<'a>(
    value: &'a Value,
    key: &str,
    max: usize,
) -> Result<Option<&'a str>, AppError> {
    value
        .get(key)
        .map(|value| {
            value
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= max)
                .ok_or_else(invalid_response)
        })
        .transpose()
}
fn metadata(value: &Value) -> Result<(), AppError> {
    if value
        .get("metadata")
        .is_some_and(|value| !value.is_object())
    {
        Err(invalid_response())
    } else {
        Ok(())
    }
}
