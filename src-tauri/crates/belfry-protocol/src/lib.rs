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
    /// 列出共享上下文条目（只有元数据，正文要单独取）。
    ContextList,
    /// 取一条的正文。内联的和落盘的对调用方没有区别。
    #[serde(rename_all = "camelCase")]
    ContextGet { id: String },
    /// 写一条。正文长短由 app 侧决定内联还是落盘。
    #[serde(rename_all = "camelCase")]
    ContextPut {
        title: String,
        body: String,
        #[serde(default)]
        tags: Vec<String>,
    },
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
    Peers { peers: Vec<Peer> },
    ContextList { items: Vec<ContextEntry> },
    ContextBody { body: String },
    ContextPut { id: String, reference: String },
}

/// 一条会话在别人眼里的样子。
///
/// 不暴露 token，也不暴露 PTY 内部状态——这份数据是给另一个 Agent 读的。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub tab_id: String,
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

/// 共享上下文条目的精简视图。
///
/// 只给 Agent 需要的：认得出是什么、知道怎么取。落盘的直接给相对路径，
/// 让它自己去读——这比把正文塞进响应省 token，也是它更擅长的事。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEntry {
    pub id: String,
    pub title: String,
    pub kind: String,
    /// 相对项目根的路径；内联条目为 None。
    pub path: Option<String>,
    pub pinned: bool,
    pub tags: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_round_trips_through_json() {
        let request = Request::new(
            "tab-1".into(),
            "secret".into(),
            Command::ContextPut {
                title: "约定".into(),
                body: "只改路由字段".into(),
                tags: vec!["provider".into()],
            },
        );
        let line = serde_json::to_string(&request).unwrap();
        let parsed: Request = serde_json::from_str(&line).unwrap();

        assert_eq!(parsed.version, PROTOCOL_VERSION);
        assert_eq!(parsed.tab_id, "tab-1");
        assert!(matches!(parsed.command, Command::ContextPut { .. }));
    }

    #[test]
    fn the_wire_format_stays_single_line() {
        let request = Request::new("t".into(), "k".into(), Command::Peers);
        let line = serde_json::to_string(&request).unwrap();
        // 传输按行分帧，正文里冒出换行会把一条请求劈成两条。
        assert!(!line.contains('\n'));
    }

    #[test]
    fn tags_default_to_empty_when_absent() {
        // CLI 老版本可能不发 tags，缺字段不该让整条请求解析失败。
        let line = r#"{"version":1,"tabId":"t","token":"k",
            "command":{"kind":"contextPut","title":"a","body":"b"}}"#;
        let parsed: Request = serde_json::from_str(line).unwrap();
        match parsed.command {
            Command::ContextPut { tags, .. } => assert!(tags.is_empty()),
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
