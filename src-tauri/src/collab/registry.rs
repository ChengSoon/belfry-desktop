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

/// 前端同步过来的一条会话。
///
/// 比 `Peer` 多一个项目根：派活要判断是不是同项目，而这个信息不该暴露给
/// 别的 Agent。也不能改从身份表读——那里只有领过牌子的会话才有，
/// 名册才是前端推过来的完整状态。
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
    /// 会话的项目根。派活的同项目判断读它，不进 `Peer`。
    #[serde(default)]
    pub project_root: Option<String>,
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

    /// 把人写的目标解析成一条会话。
    ///
    /// Agent 更愿意说「reviewer」或「claude」而不是一串 tabId，所以按
    /// tabId → 标题全等 → 标题包含 → agent 名依次匹配，先精确后模糊。
    ///
    /// 歧义时宁可报错也不猜：派错人的代价是一条会话开始干与它无关的活，
    /// 比多问一句贵得多。
    pub fn resolve(&self, query: &str, exclude: &str) -> Result<SessionSnapshot, String> {
        let query = query.trim();
        if query.is_empty() {
            return Err("要指定派给谁".into());
        }
        let Ok(sessions) = self.sessions.lock() else {
            return Err("会话名册读不到".into());
        };
        let candidates: Vec<&SessionSnapshot> = sessions
            .iter()
            .filter(|session| session.tab_id != exclude)
            .collect();

        if let Some(hit) = candidates.iter().find(|session| session.tab_id == query) {
            return Ok((*hit).clone());
        }

        let needle = query.to_lowercase();
        let matchers: [fn(&SessionSnapshot, &str) -> bool; 3] = [
            |session, needle| session.title.to_lowercase() == needle,
            |session, needle| session.title.to_lowercase().contains(needle),
            |session, needle| session.agent.to_lowercase() == needle,
        ];
        for matches in matchers {
            let hits: Vec<&&SessionSnapshot> = candidates
                .iter()
                .filter(|session| matches(session, &needle))
                .collect();
            match hits.len() {
                0 => continue,
                1 => return Ok((*hits[0]).clone()),
                _ => {
                    let names: Vec<String> = hits
                        .iter()
                        .map(|session| format!("{}（{}）", session.title, session.tab_id))
                        .collect();
                    return Err(format!("「{query}」对应多条会话：{}", names.join("、")));
                }
            }
        }
        Err(format!(
            "找不到叫「{query}」的会话，用 belfry peers 看看有谁"
        ))
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
            project_root: Some("/tmp/project".to_string()),
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

    #[test]
    fn an_exact_tab_id_wins() {
        let registry = SessionRegistry::default();
        registry.replace(vec![snapshot("t1", "改存储层", true), snapshot("t2", "t1", true)]);

        // 有人把标题起成了别人的 tabId，也不该抢走精确匹配。
        assert_eq!(registry.resolve("t1", "t9").unwrap().tab_id, "t1");
    }

    #[test]
    fn a_title_substring_resolves() {
        let registry = SessionRegistry::default();
        registry.replace(vec![snapshot("t1", "写实现", true), snapshot("t2", "做审查", true)]);

        assert_eq!(registry.resolve("审查", "t1").unwrap().tab_id, "t2");
    }

    #[test]
    fn an_exact_title_beats_a_substring() {
        let registry = SessionRegistry::default();
        registry.replace(vec![
            snapshot("t1", "审查", true),
            snapshot("t2", "审查队列回滚", true),
        ]);

        // 两条都「包含」审查，但有一条正好叫这个名字，先精确后模糊才不会歧义。
        assert_eq!(registry.resolve("审查", "t9").unwrap().tab_id, "t1");
    }

    #[test]
    fn an_agent_name_resolves_when_unique() {
        let registry = SessionRegistry::default();
        let mut codex = snapshot("t2", "跑测试", true);
        codex.agent = "codex".into();
        registry.replace(vec![snapshot("t1", "写实现", true), codex]);

        assert_eq!(registry.resolve("codex", "t1").unwrap().tab_id, "t2");
    }

    #[test]
    fn an_ambiguous_target_is_an_error_not_a_guess() {
        let registry = SessionRegistry::default();
        registry.replace(vec![
            snapshot("t1", "审查 A", true),
            snapshot("t2", "审查 B", true),
        ]);

        // 派错人的代价是一条会话开始干与它无关的活，比多问一句贵得多。
        let err = registry.resolve("审查", "t9").unwrap_err();
        assert!(err.contains("多条"), "{err}");
    }

    #[test]
    fn the_sender_never_resolves_to_itself() {
        let registry = SessionRegistry::default();
        registry.replace(vec![snapshot("t1", "只有我", true)]);

        assert!(registry.resolve("只有我", "t1").is_err());
        assert!(registry.resolve("t1", "t1").is_err());
    }

    #[test]
    fn an_unknown_target_points_at_peers() {
        let registry = SessionRegistry::default();
        registry.replace(vec![snapshot("t1", "写实现", true)]);

        let err = registry.resolve("不存在的", "t9").unwrap_err();
        // 错误里要带上「下一步敲什么」。
        assert!(err.contains("belfry peers"), "{err}");
    }

    #[test]
    fn an_empty_query_is_rejected() {
        let registry = SessionRegistry::default();
        assert!(registry.resolve("   ", "t9").is_err());
    }
}
