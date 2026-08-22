//! 会话名册：Rust 侧的一份会话快照。
//!
//! 会话状态（标题、在忙什么、能不能收指令）都活在前端，Rust 这边本来一无所知。
//! 但控制 CLI 是从 PTY 里连进来的，它问「现在有谁在」时前端不在调用栈上，
//! 所以前端得把快照同步过来一份。
//!
//! 这份数据只读不判：`can_receive` 由前端按能力算好，这里不重新推导——
//! 一旦两边各自判断，迟早出现「UI 说能派活、CLI 说不能」的分歧。

use std::sync::Mutex;

use belfry_protocol::Peer;
use serde::Deserialize;

/// 前端同步过来的一条会话。字段与 `Peer` 一一对应。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub tab_id: String,
    pub title: String,
    /// `codex` / `claude` / 以后接入的其他。开放字符串：协作层不比较具体取值。
    pub agent: String,
    pub activity: String,
    /// 能不能给它派活。前端按 Agent 能力算好，这里原样转发。
    pub can_receive: bool,
}

#[derive(Default)]
pub struct SessionRegistry {
    sessions: Mutex<Vec<SessionSnapshot>>,
}

impl SessionRegistry {
    /// 整份替换。
    ///
    /// 不做增量合并：前端每次给的是完整列表，合并只会让已关闭的会话在名册里
    /// 阴魂不散，而「派活给一条已经不存在的会话」是最难查的那类问题。
    pub fn replace(&self, sessions: Vec<SessionSnapshot>) {
        if let Ok(mut current) = self.sessions.lock() {
            *current = sessions;
        }
    }

    /// 渲染成给某条会话看的名册。
    ///
    /// `viewer` 那条会标成 `is_self`——Agent 得看得出哪条是自己，否则很容易
    /// 给自己派活，转成一个自己等自己的死结。
    pub fn peers_for(&self, viewer: &str) -> Vec<Peer> {
        let Ok(sessions) = self.sessions.lock() else {
            return Vec::new();
        };
        sessions
            .iter()
            .map(|session| Peer {
                tab_id: session.tab_id.clone(),
                title: session.title.clone(),
                agent: session.agent.clone(),
                can_receive: session.can_receive,
                activity: session.activity.clone(),
                is_self: session.tab_id == viewer,
            })
            .collect()
    }

    /// 按 tabId 找一条。派活解析目标时用。
    pub fn find(&self, tab_id: &str) -> Option<SessionSnapshot> {
        self.sessions
            .lock()
            .ok()?
            .iter()
            .find(|session| session.tab_id == tab_id)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(tab_id: &str, title: &str, can_receive: bool) -> SessionSnapshot {
        SessionSnapshot {
            tab_id: tab_id.to_string(),
            title: title.to_string(),
            agent: "claude".to_string(),
            activity: "idle".to_string(),
            can_receive,
        }
    }

    #[test]
    fn the_viewer_is_marked_as_itself() {
        let registry = SessionRegistry::default();
        registry.replace(vec![snapshot("t1", "改存储层", true), snapshot("t2", "跑测试", true)]);

        let peers = registry.peers_for("t1");

        assert_eq!(peers.len(), 2);
        assert!(peers[0].is_self, "自己那条要标出来，否则容易给自己派活");
        assert!(!peers[1].is_self);
    }

    #[test]
    fn replacing_drops_sessions_that_are_gone() {
        let registry = SessionRegistry::default();
        registry.replace(vec![snapshot("t1", "旧的", true)]);
        registry.replace(vec![snapshot("t2", "新的", true)]);

        let peers = registry.peers_for("t2");

        // 整份替换而不是合并：已关闭的会话留在名册里会让派活打到空处。
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].tab_id, "t2");
        assert!(registry.find("t1").is_none());
    }

    #[test]
    fn can_receive_is_forwarded_not_recomputed() {
        let registry = SessionRegistry::default();
        registry.replace(vec![snapshot("t1", "退出了", false)]);

        // 前端说不能收就是不能收，这一层不自己推导，避免两边判断出现分歧。
        assert!(!registry.peers_for("t9")[0].can_receive);
    }

    #[test]
    fn an_empty_registry_answers_with_an_empty_roster() {
        let registry = SessionRegistry::default();
        assert!(registry.peers_for("t1").is_empty());
    }
}
