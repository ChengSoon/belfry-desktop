//! 共享上下文的线上格式。字段和 `src/collab/contracts.ts` 一一对应。
//!
//! `index.json` 是这些结构直接序列化出来的，所以它同时是**给 Agent 看的格式**——
//! 字段名要能自解释，不能为了省字节起缩写。

use serde::{Deserialize, Serialize};

use crate::agent::AgentKind;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContextKind {
    /// 用户手写的约定、决策。
    Note,
    /// 从终端屏幕上截的片段。
    Excerpt,
    /// 某一步跑出来的产物。
    Artifact,
    /// 从 CLI 自己的会话日志里提炼的摘要。
    Digest,
}

/// 一条上下文的来路。同一段文字，用户手敲的和从屏幕抓的可信度不一样，UI 要能区分。
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "from", rename_all = "camelCase")]
pub enum ContextSource {
    User,
    #[serde(rename_all = "camelCase")]
    Terminal { tab_id: String },
    /// `agent` 是开放字符串而不是 `AgentKind`：这一层不比较也不构造具体
    /// agent 取值，接入第四个 CLI 时这里不该需要改动。
    #[serde(rename_all = "camelCase")]
    Agent { tab_id: String, agent: String },
    #[serde(rename_all = "camelCase")]
    History { session: ContextSessionRef },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSessionRef {
    pub agent: AgentKind,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub id: String,
    pub kind: ContextKind,
    pub title: String,
    /// 短内容内联在索引里；长内容为 None，正文在 `path` 指的文件。
    pub body: Option<String>,
    /// 相对项目根的路径，给 Agent 直接读。
    pub path: Option<String>,
    pub source: ContextSource,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 写入请求。正文单独给，由存储层决定内联还是落盘——这个决定不该让调用方操心。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextWrite {
    pub id: String,
    pub kind: ContextKind,
    pub title: String,
    pub body: String,
    pub source: ContextSource,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
