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
    /// 用户给这条会话起的唯一名。派活只认它（或 tabId）。
    ///
    /// 刻意不用 `title`：Agent 会话的标题是从最后一条输入自动生成的，每敲一条
    /// prompt 就变，还可能重复、可能是一整句中文——拿它当寻址键必然派错人。
    #[serde(default)]
    pub name: Option<String>,
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
                name: session.name.clone(),
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

    /// 把目标解析成一条会话。
    ///
    /// 只认两样：会话的唯一名（大小写不敏感）和 tabId。**不做模糊匹配**——
    /// 标题会随每条 prompt 变，agent 类型又可能对应好几条会话，靠它们猜的代价
    /// 是一条会话开始干与它无关的活。
    ///
    /// 解析不出来时错误信息要带上「能派给谁」和「谁还没命名」，Agent 才知道
    /// 下一步敲什么，而不是对着一句「找不到」反复试。
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

        // tabId 是稳定句柄，全等即命中。
        if let Some(hit) = candidates.iter().find(|session| session.tab_id == query) {
            return Ok((*hit).clone());
        }

        let needle = query.to_lowercase();
        let hits: Vec<&&SessionSnapshot> = candidates
            .iter()
            .filter(|session| {
                session
                    .name
                    .as_deref()
                    .is_some_and(|name| name.to_lowercase() == needle)
            })
            .collect();
        match hits.len() {
            1 => Ok((*hits[0]).clone()),
            // 唯一性由命名那一侧把关，这里兜一道：真撞了也不能随便挑一条。
            0 => Err(unresolved_message(query, &candidates)),
            _ => Err(format!(
                "「{query}」对应多条会话，先在侧栏把名字改成不重复的"
            )),
        }
    }
}

fn unresolved_message(query: &str, candidates: &[&SessionSnapshot]) -> String {
    if candidates.is_empty() {
        return "现在没有别的会话可以派活".into();
    }
    let named: Vec<&str> = candidates
        .iter()
        .filter_map(|session| session.name.as_deref())
        .collect();
    let unnamed = candidates.len() - named.len();

    let mut message = format!("找不到叫「{query}」的会话。");
    if !named.is_empty() {
        message.push_str(&format!("能派的有：{}。", named.join("、")));
    }
    if unnamed > 0 {
        message.push_str(&format!(
            "另有 {unnamed} 条还没起名字，要派给它得先在侧栏命名。"
        ));
    }
    message.push_str("用 belfry peers 看详情。");
    message
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(tab_id: &str, title: &str, can_receive: bool) -> SessionSnapshot {
        SessionSnapshot {
            tab_id: tab_id.to_string(),
            name: None,
            title: title.to_string(),
            agent: "claude".to_string(),
            activity: "idle".to_string(),
            can_receive,
            project_root: Some("/tmp/project".to_string()),
        }
    }

    /// 起了名字的会话。名字才是寻址键，标题只是给人看的。
    fn named(tab_id: &str, name: &str, title: &str) -> SessionSnapshot {
        SessionSnapshot {
            name: Some(name.to_string()),
            ..snapshot(tab_id, title, true)
        }
    }

    #[test]
    fn the_viewer_is_marked_as_itself() {
        let registry = SessionRegistry::default();
        registry.replace(vec![
            snapshot("t1", "改存储层", true),
            snapshot("t2", "跑测试", true),
        ]);

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
        registry.replace(vec![
            snapshot("t1", "改存储层", true),
            snapshot("t2", "t1", true),
        ]);

        // 有人把标题起成了别人的 tabId，也不该抢走精确匹配。
        assert_eq!(registry.resolve("t1", "t9").unwrap().tab_id, "t1");
    }

    #[test]
    fn a_name_resolves() {
        let registry = SessionRegistry::default();
        registry.replace(vec![
            named("t1", "worker", "写实现"),
            named("t2", "reviewer", "做审查"),
        ]);

        assert_eq!(registry.resolve("reviewer", "t1").unwrap().tab_id, "t2");
    }

    #[test]
    fn a_name_is_case_insensitive() {
        let registry = SessionRegistry::default();
        registry.replace(vec![named("t2", "reviewer", "做审查")]);

        assert_eq!(registry.resolve("Reviewer", "t1").unwrap().tab_id, "t2");
    }

    #[test]
    fn a_title_never_resolves() {
        let registry = SessionRegistry::default();
        registry.replace(vec![named("t2", "reviewer", "做审查队列回滚")]);

        // 标题是从最后一条输入自动生成的，每敲一条 prompt 就变。
        // 曾经支持过标题（全等和子串）寻址，那等于让派活跟着对方的聊天内容漂。
        assert!(registry.resolve("做审查队列回滚", "t1").is_err());
        assert!(registry.resolve("审查", "t1").is_err());
    }

    #[test]
    fn an_agent_kind_never_resolves() {
        let registry = SessionRegistry::default();
        let mut codex = named("t2", "tester", "跑测试");
        codex.agent = "codex".into();
        registry.replace(vec![named("t1", "worker", "写实现"), codex]);

        // 同一类 agent 可能开着好几条，拿类型当目标必然有一天派错人。
        assert!(registry.resolve("codex", "t1").is_err());
    }

    #[test]
    fn an_unnamed_session_cannot_be_addressed_but_is_reported() {
        let registry = SessionRegistry::default();
        registry.replace(vec![
            named("t1", "reviewer", "做审查"),
            snapshot("t2", "还没起名", true),
        ]);

        let err = registry.resolve("还没起名", "t9").unwrap_err();
        // 错误要说清「能派给谁」和「有几条还没命名」，Agent 才知道下一步干什么。
        assert!(err.contains("reviewer"), "要列出能派的：{err}");
        assert!(err.contains("1 条还没起名字"), "要点出未命名的数量：{err}");
    }

    #[test]
    fn a_duplicate_name_is_an_error_not_a_guess() {
        let registry = SessionRegistry::default();
        registry.replace(vec![
            named("t1", "reviewer", "审查 A"),
            named("t2", "reviewer", "审查 B"),
        ]);

        // 唯一性由命名那一侧把关，这里兜一道：真撞了也不能随便挑一条，
        // 派错人的代价是一条会话开始干与它无关的活。
        let err = registry.resolve("reviewer", "t9").unwrap_err();
        assert!(err.contains("多条"), "{err}");
    }

    #[test]
    fn the_sender_never_resolves_to_itself() {
        let registry = SessionRegistry::default();
        registry.replace(vec![named("t1", "solo", "只有我")]);

        assert!(registry.resolve("solo", "t1").is_err());
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
