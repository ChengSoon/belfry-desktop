//! Native context is bound through the authenticated PTY ticket and daemon hook
//! identity. Never choose a transcript by directory, timestamp, or plugin input.
use crate::{agent::AgentKind, terminal::TerminalRuntime};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

pub(super) fn resolve(app: &AppHandle, args: &Value) -> Result<Value, String> {
    let ticket = args[0].as_str().ok_or("缺少 Agent 连接标识")?;
    let terminal = app
        .state::<super::PluginRuntime>()
        .sessions
        .lock()
        .map_err(|_| "插件会话表不可用")?
        .iter()
        .find(|(_, id)| id.as_str() == ticket)
        .map(|(terminal, _)| terminal.clone())
        .ok_or("Agent 连接已关闭")?;
    let runtime = app.state::<TerminalRuntime>();
    let info = runtime
        .background_sessions()
        .map_err(|e| e.message)?
        .into_iter()
        .find(|i| i.session.id == terminal)
        .ok_or("终端会话已关闭")?;
    let session = info
        .native_session
        .ok_or("尚未收到 CLI 的原生会话身份，请开启 Hook 后重试")?;
    if AgentKind::from_profile_id(&info.profile_id) != Some(session.agent)
        || !crate::history::native::supported(session.agent)
    {
        return Err("CLI 类型与原生会话身份不匹配".into());
    }
    session.validate()?;
    let root = if args[1] == true {
        crate::history::native::refresh(session.agent, Some(&session.id), &|| Ok(()))
            .map_err(|e| e.message)?
    } else {
        crate::history::native::root(session.agent).ok_or("找不到原生历史缓存目录")?
    };
    let still_current = runtime
        .background_sessions()
        .map_err(|e| e.message)?
        .iter()
        .any(|i| i.session.id == terminal && i.native_session.as_ref() == Some(&session));
    if !still_current {
        return Err("读取期间原生会话已切换，请重试".into());
    }
    Ok(json!({"agentSession":session,"historyRoot":root}))
}
