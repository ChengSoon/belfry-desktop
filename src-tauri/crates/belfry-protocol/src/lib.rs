//! Belfry 控制 CLI 与桌面端之间的线上协议。
//!
//! 单独成 crate 是为了让两侧共用同一份类型定义：CLI 打进安装包后改不动，
//! 手抄一份结构体迟早会和 app 侧漂移，而漂移的症状是「命令静默地不生效」。
//!
//! 传输是一来一回的单行 JSON：请求一行、响应一行、关闭连接。不做长连接，
//! 也不做流式——CLI 的每次调用都是一次性的，多余的状态只会带来重连语义。

use serde::{Deserialize, Serialize};

/// 协议版本。
///
/// app 升级后用户的终端里可能还留着旧 CLI 进程，握手对不上时要明确报错，
/// 而不是让字段缺失表现成「参数没传对」这种误导性行为。
pub const PROTOCOL_VERSION: u32 = 1;

/// 注入到 Agent PTY 环境里的变量名。CLI 靠它们知道自己是谁、往哪连。
pub const ENV_TAB_ID: &str = "BELFRY_TAB_ID";
pub const ENV_TOKEN: &str = "BELFRY_TOKEN";
pub const ENV_PROJECT: &str = "BELFRY_PROJECT";
/// 形如 `unix:/tmp/belfry-501.sock` 或 `tcp:127.0.0.1:54321`。
///
/// macOS 走 Unix socket：文件权限 0600 就能把访问面锁到本用户。
/// Windows 没有等价的简单原语（named pipe 要手写 win32 调用），退回 loopback
/// TCP——本机其他进程能连上，但没有 token 做不了任何事。
pub const ENV_ENDPOINT: &str = "BELFRY_ENDPOINT";

/// 一次请求。
///
/// `tab_id` + `token` 是每条请求都要带的身份。只认 tab_id 是不够的：
/// 它会出现在日志、截图和 Agent 自己的上下文里，谁抄到都能冒充别人发指令。
/// token 只活在环境变量里，不进任何输出。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub version: u32,
    pub tab_id: String,
    pub token: String,
    pub command: Command,
}

impl Request {
    pub fn new(tab_id: String, token: String, command: Command) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            tab_id,
            token,
            command,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Command {
    /// 现在有哪些会话、各自什么状态。派活之前先看一眼。
    Peers,
    /// 派活给另一条会话。
    ///
    /// `to` 是目标会话的唯一名（用户在侧栏起的，如 `reviewer`），也接受 tabId。
    /// 不接受标题片段或 agent 类型：标题会随每条 prompt 变，而同类会话可能有好几条。
    #[serde(rename_all = "camelCase")]
    Send {
        to: String,
        instruction: String,
        /// 这条指令是在完成哪个任务的过程中发出的。
        /// 用来算转包层数和检测环——Agent 自己不必理解，照抄收到的编号即可。
        #[serde(default)]
        parent_task: Option<String>,
    },
    /// 我把派给我的任务做完了。
    ///
    /// 唯一可信的完成信号：屏幕上看着像结束了不算数。
    #[serde(rename_all = "camelCase")]
    Done {
        task: String,
        #[serde(default)]
        result: Option<String>,
    },
    /// 我做不了这条任务。
    #[serde(rename_all = "camelCase")]
    Fail { task: String, reason: String },
    /// 派给我、我还没结的任务。Agent 忘了任务编号时可以查。
    Inbox,
    /// 查一条自己派出去的任务现在什么状态。
    ///
    /// `wait` 靠反复问它来实现——轮询留在 CLI 侧，服务端不用为每个等待方
    /// hold 住一条连接。只能查自己派的：别人的任务不该被看见。
    #[serde(rename_all = "camelCase")]
    TaskState { task: String },
}

/// 一次响应。
///
/// 刻意不用 `Result`：CLI 要把失败原因原样打给 Agent 看，而 Agent 读到的是
/// 终端文本，结构化的错误类型对它没有意义，一句人话更有用。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Response {
    Ok { data: ResponseData },
    Error { message: String },
}

impl Response {
    pub fn error(message: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResponseData {
    Peers {
        peers: Vec<Peer>,
    },
    /// 派活受理了。`pendingApproval` 为真时还在等用户点头——
    /// 要让 Agent 知道「已受理」不等于「已送到」，否则它会以为对方已经开工。
    #[serde(rename_all = "camelCase")]
    Sent {
        task: String,
        to: String,
        pending_approval: bool,
    },
    /// 任务结了。
    #[serde(rename_all = "camelCase")]
    Settled {
        task: String,
    },
    Inbox {
        tasks: Vec<InboxTask>,
    },
    /// 一条任务此刻的状态。
    #[serde(rename_all = "camelCase")]
    TaskState {
        task: String,
        /// `pendingapproval` / `queued` / `dispatched` / `done` / `failed` / `abandoned`。
        state: String,
        /// 到终点了没。**由 app 侧判定**——CLI 不该自己维护一份「哪些算结束」的清单，
        /// 那份清单迟早和 app 的状态机漂开，而漂开的表现是 `wait` 永远不返回。
        settled: bool,
        /// 目标交差时写的那句话；没结或没写就是 None。
        result: Option<String>,
    },
}

/// 派给我、还没结的一条任务。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxTask {
    pub task: String,
    pub from: String,
    pub instruction: String,
    pub state: String,
}

/// 一条会话在别人眼里的样子。
///
/// 不暴露 token，也不暴露 PTY 内部状态——这份数据是给另一个 Agent 读的。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub tab_id: String,
    /// 用户给这条会话起的唯一名（`reviewer` / `frontend`）。派活就认它。
    ///
    /// None 表示还没命名——此时无法被寻址，`peers` 要把这件事说出来，
    /// 否则 Agent 会拿标题去猜，而标题每敲一条 prompt 就变。
    #[serde(default)]
    pub name: Option<String>,
    pub title: String,
    /// Agent 标识（`codex` / `claude` / 以后接入的其他）。
    ///
    /// 是开放字符串而不是枚举：协作层不该因为多接一个 CLI 就要改协议。
    pub agent: String,
    /// 能不能给它派活。由 app 侧按能力判断，CLI 不自己推断。
    pub can_receive: bool,
    /// 眼下在干什么，供人和 Agent 判断该不该现在打扰它。
    pub activity: String,
    /// 自己那条会话在列表里标出来，免得 Agent 给自己派活。
    pub is_self: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_round_trips_through_json() {
        let request = Request::new(
            "tab-1".into(),
            "secret".into(),
            Command::Send {
                to: "reviewer".into(),
                instruction: "只改路由字段".into(),
                parent_task: Some("01hx".into()),
            },
        );
        let line = serde_json::to_string(&request).unwrap();
        let parsed: Request = serde_json::from_str(&line).unwrap();

        assert_eq!(parsed.version, PROTOCOL_VERSION);
        assert_eq!(parsed.tab_id, "tab-1");
        assert!(matches!(parsed.command, Command::Send { .. }));
    }

    #[test]
    fn the_wire_format_stays_single_line() {
        let request = Request::new("t".into(), "k".into(), Command::Peers);
        let line = serde_json::to_string(&request).unwrap();
        // 传输按行分帧，正文里冒出换行会把一条请求劈成两条。
        assert!(!line.contains('\n'));
    }

    #[test]
    fn an_optional_field_defaults_when_absent() {
        // 顶层派活没有父任务，CLI 不会发 parentTask；缺字段不该让整条请求解析失败。
        let line = r#"{"version":1,"tabId":"t","token":"k",
            "command":{"kind":"send","to":"reviewer","instruction":"审一下"}}"#;
        let parsed: Request = serde_json::from_str(line).unwrap();
        match parsed.command {
            Command::Send { parent_task, .. } => assert!(parent_task.is_none()),
            other => panic!("解析成了别的命令：{other:?}"),
        }
    }

    #[test]
    fn responses_carry_a_readable_message_on_failure() {
        let response = Response::error("没有这条会话");
        let line = serde_json::to_string(&response).unwrap();
        assert!(line.contains("没有这条会话"));

        let parsed: Response = serde_json::from_str(&line).unwrap();
        assert!(matches!(parsed, Response::Error { .. }));
    }
}
