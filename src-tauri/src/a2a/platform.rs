use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

#[cfg(test)]
use super::store::Store;
use super::{
    A2aRuntime,
    commands::store,
    connections::ConnectionSource,
    errors::error,
    local::{self, LocalGateway},
    requests::Owner,
};
use crate::terminal::AppError;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectionRequest {
    connection_id: String,
    request_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendRequest {
    connection_id: String,
    request_id: String,
    text: String,
    task_handle: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskRequest {
    task_handle: String,
    request_id: String,
    history_length: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelTaskRequest {
    task_handle: String,
    request_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelRequest {
    request_id: String,
}

fn parse<T: for<'de> Deserialize<'de>>(value: &Value) -> Result<T, AppError> {
    serde_json::from_value(value.clone()).map_err(|_| {
        error(
            "A2A_ARGUMENT_INVALID",
            "The A2A tool arguments do not match the host contract.",
        )
    })
}

fn owner(app: &AppHandle, request: &Value) -> Result<Owner, AppError> {
    let workspace = request["context"]["workspace"].as_str().unwrap_or("");
    let ticket = request["context"]["sessionId"].as_str().unwrap_or("");
    let root = crate::plugins::agent_connection::authorized_workspace(app, workspace, ticket)?;
    Ok(Owner::agent(root, ticket.into()))
}

/// The existing platform transport returns strings on errors. A2A carries AppError
/// inside a successful transport envelope so rpcCode/outcomeUnknown are preserved.
pub(crate) fn dispatch(app: &AppHandle, request: &Value, api: &str) -> Value {
    envelope((|| {
        let owner = owner(app, request)?;
        let agent = crate::plugins::agent_connection::authorized_agent(
            app,
            &owner.root,
            owner.ticket.as_deref().unwrap_or(""),
        )?;
        let runtime = app.state::<A2aRuntime>();
        let store = store(app)?;
        let service = app
            .try_state::<LocalGateway>()
            .and_then(|gateway| gateway.service().ok());
        let connections = local::ScopedConnections {
            store: &store,
            service: service.clone(),
            owner: &agent,
        };
        let value = if api.starts_with("a2a.local") {
            let service = service.ok_or_else(|| {
                error(
                    "A2A_LOCAL_UNAVAILABLE",
                    "The local A2A gateway is unavailable.",
                )
            })?;
            local::dispatch_tools(
                &service,
                &runtime,
                &connections,
                &agent,
                argument(request)?,
                api,
            )?
        } else {
            dispatch_source(&runtime, &connections, &owner, request, api)?
        };
        // Recheck the live terminal after I/O, including any revoke/exit during it.
        if crate::plugins::agent_connection::authorized_workspace(
            app,
            &owner.root,
            owner.ticket.as_deref().unwrap_or(""),
        )
        .is_err()
        {
            runtime.invalidate_session(owner.ticket.as_deref().unwrap_or(""));
            return Err(error(
                "A2A_AGENT_SESSION_INVALID",
                "The originating agent session ended. Its A2A result was discarded.",
            ));
        }
        Ok(value)
    })())
}

/// Operations after the caller has been authenticated by the host. Tests reuse
/// this route with synthetic owners; production always passes through dispatch.
#[cfg(test)]
pub(super) fn dispatch_authorized(
    runtime: &A2aRuntime,
    store: &Store,
    owner: &Owner,
    request: &Value,
    api: &str,
) -> Result<Value, AppError> {
    dispatch_source(runtime, store, owner, request, api)
}
pub(super) fn dispatch_source(
    runtime: &A2aRuntime,
    store: &dyn ConnectionSource,
    owner: &Owner,
    request: &Value,
    api: &str,
) -> Result<Value, AppError> {
    let args = argument(request)?;
    let value = match api {
        "a2a.connections" => {
            let _: Empty = parse(args)?;
            json!(runtime.list(store, &owner.root)?)
        }
        "a2a.agentCard" => {
            let input: ConnectionRequest = parse(args)?;
            json!(tauri::async_runtime::block_on(runtime.agent_card(
                store,
                owner,
                &input.connection_id,
                &input.request_id
            ))?)
        }
        "a2a.sendMessage" => {
            let input: SendRequest = parse(args)?;
            json!(tauri::async_runtime::block_on(runtime.send_message(
                store,
                owner,
                &input.connection_id,
                &input.request_id,
                &input.text,
                input.task_handle.as_deref()
            ))?)
        }
        "a2a.getTask" => {
            let input: TaskRequest = parse(args)?;
            json!(tauri::async_runtime::block_on(runtime.task(
                store,
                owner,
                &input.task_handle,
                &input.request_id,
                false,
                input.history_length.unwrap_or(0)
            ))?)
        }
        "a2a.cancelTask" => {
            let input: CancelTaskRequest = parse(args)?;
            json!(tauri::async_runtime::block_on(runtime.task(
                store,
                owner,
                &input.task_handle,
                &input.request_id,
                true,
                0
            ))?)
        }
        "a2a.cancelRequest" => {
            let input: CancelRequest = parse(args)?;
            json!(runtime.cancel_request(owner, &input.request_id)?)
        }
        _ => {
            return Err(error(
                "A2A_API_UNSUPPORTED",
                "This A2A host API is not implemented.",
            ));
        }
    };
    Ok(value)
}
fn argument(request: &Value) -> Result<&Value, AppError> {
    request["args"]
        .as_array()
        .filter(|items| items.len() == 1)
        .and_then(|items| items.first())
        .filter(|value| value.is_object())
        .ok_or_else(|| {
            error(
                "A2A_ARGUMENT_INVALID",
                "The A2A host expects one argument object.",
            )
        })
}

/// Host replies travel through the embedded Node bridge, whose message limit is
/// 1 MiB. Fail fast with an explicit, bounded error instead of letting an
/// oversized reply be dropped and surface as a bridge timeout.
const MAX_PUBLIC_REPLY: usize = 900 * 1024;

pub(super) fn envelope(result: Result<Value, AppError>) -> Value {
    match result {
        Ok(value) => {
            let size = serde_json::to_vec(&value)
                .map(|bytes| bytes.len())
                .unwrap_or(usize::MAX);
            if size > MAX_PUBLIC_REPLY {
                failure(error(
                    "A2A_RESPONSE_LIMIT",
                    "This A2A result is too large to return through the Agent bridge. Read one task or message, reduce historyLength, or narrow the request.",
                ))
            } else {
                json!({"ok":true, "value":value})
            }
        }
        Err(error) => failure(error),
    }
}

fn failure(error: AppError) -> Value {
    json!({"ok":false, "error":{
        "code":error.code, "message":error.message, "retryable":error.retryable,
        "details":error.details, "params":error.params,
    }})
}
