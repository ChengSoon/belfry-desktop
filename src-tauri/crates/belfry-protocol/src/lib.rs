//! Belfry 控制 CLI 与桌面端之间的线上协议。
//!
//! 单独成 crate 是为了让两侧共用同一份类型定义：CLI 打进安装包后改不动，
//! 手抄一份结构体迟早会和 app 侧漂移，而漂移的症状是「命令静默地不生效」。
//!
//! 传输是一来一回的单行 JSON：请求一行、响应一行、关闭连接。不做长连接，
//! 也不做流式——CLI 的每次调用都是一次性的，多余的状态只会带来重连语义。

pub mod hooks;
pub mod room_compat;

use serde::{Deserialize, Serialize};

/// 协议版本。
///
/// app 升级后用户的终端里可能还留着旧 CLI 进程，握手对不上时要明确报错，
/// 而不是让字段缺失表现成「参数没传对」这种误导性行为。
pub const PROTOCOL_VERSION: u32 = 1;

/// 房间命令及其回执的能力标记，随 `peers` 返回。
///
/// 旧后台也认识 peers，但会在重编码响应时丢掉 capabilities。CLI 因而能在真正
/// 发消息、建任务之前识别整条链路是否兼容，避免操作成功后回执损坏导致重复提交。
pub const CAPABILITY_ROOMS_V1: &str = "rooms_v1";

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
    /// 我在的协作房间：角色、统筹是谁、需求目标、还有几条活没完。
    Rooms,
    /// 房间全貌：需求简报、成员与职责、任务板、等我回复的消息。
    ///
    /// `room` 省略时按「你只在一间房里」自动选；同时在多间房里要写房间名。下同。
    #[serde(rename_all = "camelCase")]
    RoomStatus {
        #[serde(default)]
        room: Option<String>,
    },
    /// 往房间里发一条消息。`to` 为空时先看正文里的 `@角色`，再按默认收件人：
    /// 成员发给统筹，统筹发给全体成员。`ask` 为真＝要求回复，收件人回复前一直挂着「待回复」。
    #[serde(rename_all = "camelCase")]
    RoomSay {
        #[serde(default)]
        room: Option<String>,
        text: String,
        /// 回复哪条消息：`room log` 里的短 id。带它时默认回给原发件人。
        #[serde(default)]
        reply_to: Option<String>,
        /// 收件人：角色名，或 `@统筹` `@全体` `@成员` `@用户`。
        #[serde(default)]
        to: Vec<String>,
        #[serde(default)]
        ask: bool,
    },
    /// 读房间最近的对话。
    #[serde(rename_all = "camelCase")]
    RoomLog {
        #[serde(default)]
        room: Option<String>,
        /// 最多读几条，默认 20，上限 50。
        #[serde(default)]
        count: Option<u32>,
    },
    /// 任务板上的一步操作。
    #[serde(rename_all = "camelCase")]
    RoomTask {
        #[serde(default)]
        room: Option<String>,
        op: RoomTaskOp,
    },
    /// 改需求简报。只有统筹（和用户）能改；没给的字段不动。
    #[serde(rename_all = "camelCase")]
    RoomBrief {
        #[serde(default)]
        room: Option<String>,
        #[serde(default)]
        objective: Option<String>,
        #[serde(default)]
        focus: Option<String>,
        /// 给了就整份替换。
        #[serde(default)]
        constraints: Option<Vec<String>>,
    },
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

impl Command {
    pub fn is_room(&self) -> bool {
        matches!(
            self,
            Self::Rooms
                | Self::RoomStatus { .. }
                | Self::RoomSay { .. }
                | Self::RoomLog { .. }
                | Self::RoomTask { .. }
                | Self::RoomBrief { .. }
        )
    }
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
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        capabilities: Vec<String>,
    },
    Rooms {
        rooms: Vec<RoomBrief>,
    },
    #[serde(rename_all = "camelCase")]
    RoomStatus {
        status: RoomStatusView,
    },
    /// 消息记进房间了。
    #[serde(rename_all = "camelCase")]
    RoomSaid {
        room: String,
        /// 这条消息的短 id。
        message: String,
        /// 收件人角色名（发给用户时是「用户」）。
        recipients: Vec<String>,
        /// 收件人里会话已经不在的，逐条说清。
        skipped: Vec<String>,
        ask: bool,
    },
    #[serde(rename_all = "camelCase")]
    RoomLog {
        room: String,
        entries: Vec<RoomLine>,
    },
    /// 任务板改动生效了。
    #[serde(rename_all = "camelCase")]
    RoomTaskChanged {
        room: String,
        task: RoomTaskLine,
        /// 一句结果说明（比如「已通知统筹」）。
        note: String,
    },
    #[serde(rename_all = "camelCase")]
    RoomBriefUpdated {
        room: String,
        brief: RoomBriefView,
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

/// 任务板上的一步操作。任务号写 `T3`（`3` 也认）。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum RoomTaskOp {
    /// 建一条任务。`assignee` 是角色名；`after` 是要先完成的任务号。
    #[serde(rename_all = "camelCase")]
    Add {
        title: String,
        #[serde(default)]
        outcome: Option<String>,
        #[serde(default)]
        assignee: Option<String>,
        #[serde(default)]
        after: Vec<String>,
    },
    /// 换负责人（统筹）；成员只能认领没人接的任务给自己。
    #[serde(rename_all = "camelCase")]
    Assign { task: String, assignee: String },
    #[serde(rename_all = "camelCase")]
    Start { task: String },
    #[serde(rename_all = "camelCase")]
    Done {
        task: String,
        #[serde(default)]
        result: Option<String>,
    },
    /// 退回「待开工」（自己的任务）或重开已完成的任务（统筹）。
    #[serde(rename_all = "camelCase")]
    Reopen { task: String },
    /// 追加一条进展备注。
    #[serde(rename_all = "camelCase")]
    Note { task: String, text: String },
    #[serde(rename_all = "camelCase")]
    Archive { task: String },
}

/// 我在的一间房。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomBrief {
    pub name: String,
    /// 我在这间房里的角色名。
    pub my_title: String,
    pub my_duty: String,
    pub i_am_foreman: bool,
    /// 统筹的角色名；还没定统筹时为 None。
    pub foreman: Option<String>,
    pub objective: String,
    /// 没完成的任务数。
    pub open_tasks: usize,
    /// 等我回复的消息数。
    pub awaiting_me: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomBriefView {
    pub objective: String,
    pub focus: String,
    pub constraints: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomMemberLine {
    pub title: String,
    /// `统筹` 或 `成员`。
    pub role: String,
    pub duty: String,
    pub is_me: bool,
    /// 会话此刻在忙什么（idle / talking / awaiting-choice / offline）。
    pub activity: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomTaskLine {
    pub id: String,
    pub title: String,
    /// 中文状态名：待开工 / 进行中 / 已完成 / 已归档。
    pub status: String,
    pub assignee: Option<String>,
    pub outcome: String,
    /// 还没完成的前置任务。
    pub waiting_for: Vec<String>,
    pub notes: String,
    pub result: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomStatusView {
    pub room: String,
    pub my_title: String,
    pub i_am_foreman: bool,
    /// Current responsibility, workload and routing context. Older servers may omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordination: Option<String>,
    pub brief: RoomBriefView,
    pub members: Vec<RoomMemberLine>,
    pub tasks: Vec<RoomTaskLine>,
    /// 要求我回复、我还没回的消息。
    pub awaiting_me: Vec<RoomLine>,
}

/// 房间对话里的一行。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomLine {
    /// 短消息 id：回复时写它。
    pub id: String,
    /// 角色名，或「用户」「系统」。
    pub author: String,
    /// 收件人角色名；系统注记只记在时间线上时为空。
    pub to: Vec<String>,
    pub text: String,
    pub at: i64,
    /// 回复了哪句：「回复 [id] 谁：「原话」」。
    pub reply_preview: Option<String>,
    /// 这条要求回复，而我还没回。
    pub needs_my_reply: bool,
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

    #[test]
    fn a_room_say_round_trips_and_old_clients_still_parse() {
        let request = Request::new(
            "t".into(),
            "k".into(),
            Command::RoomSay {
                room: Some("登录改版".into()),
                text: "接口定了吗".into(),
                reply_to: None,
                to: vec!["后端".into()],
                ask: true,
            },
        );
        let line = serde_json::to_string(&request).unwrap();
        match serde_json::from_str::<Request>(&line).unwrap().command {
            Command::RoomSay { to, ask, .. } => {
                assert_eq!(to, vec!["后端".to_string()]);
                assert!(ask);
            }
            other => panic!("{other:?}"),
        }
        // 旧 CLI 发的 roomSay 没有 to / ask：按默认值读，不报格式错。
        let old = r#"{"version":1,"tabId":"t","token":"k","command":{"kind":"roomSay","text":"在吗"}}"#;
        assert!(matches!(
            serde_json::from_str::<Request>(old).unwrap().command,
            Command::RoomSay { ask: false, .. }
        ));
    }

    #[test]
    fn a_room_task_op_round_trips() {
        let request = Request::new(
            "t".into(),
            "k".into(),
            Command::RoomTask {
                room: None,
                op: RoomTaskOp::Add {
                    title: "登录接口".into(),
                    outcome: Some("返回 token".into()),
                    assignee: Some("后端".into()),
                    after: vec!["T1".into()],
                },
            },
        );
        let line = serde_json::to_string(&request).unwrap();
        assert!(line.contains(r#""op":"add""#), "{line}");
        match serde_json::from_str::<Request>(&line).unwrap().command {
            Command::RoomTask { op: RoomTaskOp::Add { after, .. }, .. } => assert_eq!(after, vec!["T1".to_string()]),
            other => panic!("{other:?}"),
        }
    }
}
