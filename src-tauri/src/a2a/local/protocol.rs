use super::{
    Service, local_error,
    types::{Link, RoomContext},
};
use crate::{plugins::agent_connection::AuthorizedAgent, terminal::AppError};
use serde::Deserialize;
use serde_json::{Value, json};

pub(super) struct RpcError {
    pub code: i64,
    pub message: String,
}
impl RpcError {
    pub fn new(code: i64, message: &str) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn reply(&self, id: &Value) -> Value {
        json!({"jsonrpc":"2.0","id":id,"error":{"code":self.code,"message":self.message}})
    }
}
impl From<AppError> for RpcError {
    fn from(error: AppError) -> Self {
        let code = match error.code.0.as_ref() {
            "A2A_TASK_NOT_CANCELABLE" => -32002,
            "A2A_LOCAL_TASK_NOT_FOUND"
            | "A2A_LOCAL_AGENT_NOT_FOUND"
            | "A2A_AGENT_SESSION_INVALID" => -32001,
            "A2A_LOCAL_TASK_CHANGED" => -32004,
            "A2A_LOCAL_UNAVAILABLE" => -32603,
            _ => -32602,
        };
        Self {
            code,
            message: error.message,
        }
    }
}
pub(super) enum RpcOutcome {
    Value(Value),
    Wait { link: Link, history_length: u32 },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Send {
    message: Value,
    configuration: Option<Configuration>,
    tenant: Option<String>,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Configuration {
    return_immediately: Option<bool>,
    history_length: Option<u32>,
    accepted_output_modes: Option<Vec<String>>,
    task_push_notification_config: Option<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskRequest {
    id: String,
    history_length: Option<u32>,
    tenant: Option<String>,
}

impl Service {
    pub(super) fn card(&self, owner: &AuthorizedAgent, target_id: &str) -> Result<Value, RpcError> {
        let record = self.target(owner, target_id)?;
        let name = self
            .registry
            .find(&record.owner.tab_id)
            .and_then(|s| s.name)
            .unwrap_or(record.owner.tab_id);
        Ok(
            json!({"name":name,"description":"Managed local Agent with explicit MCP task reports and authoritative Belfry room permissions.",
            "version":"1.0.0","supportedInterfaces":[{"url":format!("{}/agents/{target_id}/rpc",self.origin),"protocolBinding":"JSONRPC","protocolVersion":"1.0"}],
            "capabilities":{"streaming":false,"pushNotifications":false,"extendedAgentCard":false},
            "defaultInputModes":["text/plain"],"defaultOutputModes":["text/plain"],
            "securitySchemes":{"local":{"httpAuthSecurityScheme":{"scheme":"bearer"}}},
            "securityRequirements":[{"schemes":{"local":{"list":[]}}}],
            "skills":[{"id":"local-work","name":"Local project work","description":"Accept text tasks, continue input requests, and return explicitly reported progress and results within project and room permissions.","tags":["local","project","collaboration"]}]}),
        )
    }
    pub(super) fn rpc(
        &self,
        owner: &AuthorizedAgent,
        target_id: &str,
        request: &Value,
    ) -> Result<RpcOutcome, RpcError> {
        let invalid = || RpcError::new(-32602, "Invalid A2A 1.0 request parameters.");
        let params = request
            .get("params")
            .filter(|value| value.is_object())
            .ok_or_else(invalid)?;
        match request["method"].as_str().unwrap_or("") {
            "SendMessage" => {
                let input: Send = serde_json::from_value(params.clone()).map_err(|_| invalid())?;
                if input.tenant.is_some() {
                    return Err(invalid());
                }
                let configuration = input.configuration.unwrap_or_default();
                if configuration.task_push_notification_config.is_some() {
                    return Err(RpcError::new(
                        -32003,
                        "Push notifications are not supported.",
                    ));
                }
                let history_length = configuration.history_length.unwrap_or(20).min(20);
                if configuration
                    .accepted_output_modes
                    .as_ref()
                    .is_some_and(|modes| {
                        !modes.is_empty()
                            && !modes.iter().any(|mode| {
                                matches!(mode.as_str(), "text/plain" | "text/*" | "*/*")
                            })
                    })
                {
                    return Err(RpcError::new(
                        -32005,
                        "This agent produces text/plain output.",
                    ));
                }
                validate_message(&input.message)?;
                let context = input
                    .message
                    .get("metadata")
                    .and_then(|metadata| metadata.get("belfryRoom"))
                    .map(|value| {
                        serde_json::from_value::<RoomContext>(value.clone()).map_err(|_| invalid())
                    })
                    .transpose()?;
                let link = self.send(owner, target_id, input.message, context)?;
                if configuration.return_immediately.unwrap_or(false) {
                    Ok(RpcOutcome::Value(
                        json!({"task":self.task_value(&link,history_length)?}),
                    ))
                } else {
                    Ok(RpcOutcome::Wait {
                        link,
                        history_length,
                    })
                }
            }
            "GetTask" | "CancelTask" => {
                let input: TaskRequest =
                    serde_json::from_value(params.clone()).map_err(|_| invalid())?;
                if input.tenant.is_some() || input.id.is_empty() || input.id.len() > 512 {
                    return Err(invalid());
                }
                let link = if request["method"] == "CancelTask" {
                    self.cancel(owner, target_id, &input.id)?
                } else {
                    self.owned_link(owner, target_id, &input.id)?
                };
                Ok(RpcOutcome::Value(self.task_value(
                    &link,
                    input.history_length.unwrap_or(20).min(20),
                )?))
            }
            "SendStreamingMessage" | "SubscribeToTask" => Err(RpcError::new(
                -32004,
                "Streaming is not supported by this agent.",
            )),
            "CreateTaskPushNotificationConfig"
            | "GetTaskPushNotificationConfig"
            | "ListTaskPushNotificationConfigs"
            | "DeleteTaskPushNotificationConfig" => Err(RpcError::new(
                -32003,
                "Push notifications are not supported by this agent.",
            )),
            "GetExtendedAgentCard" => Err(RpcError::new(
                -32007,
                "No extended agent card is configured.",
            )),
            _ => Err(RpcError::new(-32601, "Method not found.")),
        }
    }
}
fn validate_message(message: &Value) -> Result<(), RpcError> {
    let invalid = || {
        RpcError::new(
            -32602,
            "Provide an A2A 1.0 ROLE_USER message with messageId and nonempty text parts.",
        )
    };
    if !message.is_object()
        || message["role"] != "ROLE_USER"
        || message
            .get("messageId")
            .and_then(Value::as_str)
            .is_none_or(|id| id.is_empty() || id.len() > 512)
    {
        return Err(invalid());
    }
    for name in ["taskId", "contextId"] {
        if message.get(name).is_some_and(|value| {
            value
                .as_str()
                .is_none_or(|id| id.is_empty() || id.len() > 512)
        }) {
            return Err(invalid());
        }
    }
    if message
        .get("metadata")
        .is_some_and(|value| !value.is_object())
    {
        return Err(invalid());
    }
    let parts = message["parts"]
        .as_array()
        .filter(|parts| !parts.is_empty() && parts.len() <= 64)
        .ok_or_else(invalid)?;
    let mut text = String::new();
    for part in parts {
        if !part.is_object()
            || part.get("text").and_then(Value::as_str).is_none()
            || ["raw", "url", "data", "file"]
                .iter()
                .any(|name| part.get(name).is_some())
            || part
                .get("mediaType")
                .is_some_and(|mode| mode != "text/plain")
        {
            return Err(RpcError::new(
                -32005,
                "This local agent accepts only text/plain parts.",
            ));
        }
        text.push_str(part["text"].as_str().unwrap());
        text.push('\n');
    }
    crate::a2a::validation::text(text.trim_end()).map_err(|_| {
        RpcError::from(local_error(
            "A2A_TEXT_INVALID",
            "A message must contain nonempty text within 64 KiB.",
        ))
    })
}
