//! 会话身份：谁能通过控制 CLI 说话，以及它说自己是谁算不算数。
//!
//! 每条 Agent 会话在创建时领一张牌（tabId + token），token 注入进那条 PTY 的
//! 环境变量，从不经过前端，也不进任何日志或界面。
//!
//! **为什么不能只认 tabId**：tabId 会出现在日志、截图和 Agent 自己的上下文里。
//! 只比对 tabId 的话，一个 Agent 把 `--to` 换成别人的 id 就能冒充别人派活。
//! token 只活在环境变量里，抄不到。

use std::collections::HashMap;
use std::sync::Mutex;

use belfry_protocol::{ENV_PROJECT, ENV_TAB_ID, ENV_TOKEN};

/// tabId → token。
///
/// 用 `Mutex<HashMap>` 而不是并发结构：这张表跟着会话数量走，撑死几十条，
/// 且只在会话创建/关闭和 IPC 鉴权时读写，锁竞争可以忽略。
#[derive(Default)]
pub struct SessionIdentities {
    entries: Mutex<HashMap<String, Identity>>,
}

#[derive(Clone, Debug)]
struct Identity {
    token: String,
    project_root: Option<String>,
}

impl SessionIdentities {
    /// 发一张新牌，并把要注入 PTY 的环境变量返回给调用方。
    ///
    /// 同一个 tabId 重复调用会**换发**新 token：PTY 重启（generation++）走的就是
    /// 这条路，旧 token 必须当场作废，否则重启前那个进程还能继续以这条会话的
    /// 身份说话。
    pub fn issue(&self, tab_id: &str, project_root: Option<&str>) -> Vec<(String, String)> {
        let token = ulid::Ulid::generate().to_string();
        let identity = Identity {
            token: token.clone(),
            project_root: project_root.map(str::to_string),
        };
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(tab_id.to_string(), identity);
        }

        let mut env = vec![
            (ENV_TAB_ID.to_string(), tab_id.to_string()),
            (ENV_TOKEN.to_string(), token),
        ];
        if let Some(root) = project_root {
            env.push((ENV_PROJECT.to_string(), root.to_string()));
        }
        env
    }

    /// 校验一次请求的身份。用常量时间比较，别让 token 被逐字节试出来。
    pub fn verify(&self, tab_id: &str, token: &str) -> bool {
        let Ok(entries) = self.entries.lock() else {
            return false;
        };
        entries
            .get(tab_id)
            .is_some_and(|identity| constant_time_eq(&identity.token, token))
    }

    /// 这条会话属于哪个项目。共享上下文的读写要落在它自己的项目里。
    pub fn project_root(&self, tab_id: &str) -> Option<String> {
        self.entries
            .lock()
            .ok()?
            .get(tab_id)
            .and_then(|identity| identity.project_root.clone())
    }

    /// 会话关掉就收回牌子。
    pub fn revoke(&self, tab_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(tab_id);
        }
    }
}

/// 比较不因第一个不同字节就提前返回。
///
/// token 是本机 IPC 上的凭证，计时攻击在这个场景下不现实；但写对它的成本
/// 只有几行，而写错的代价是一个需要专门审计才能发现的弱点。
fn constant_time_eq(left: &str, right: &str) -> bool {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_issued_identity_verifies() {
        let identities = SessionIdentities::default();
        let env = identities.issue("tab-1", Some("/tmp/project"));

        let token = env
            .iter()
            .find(|(key, _)| key == ENV_TOKEN)
            .map(|(_, value)| value.clone())
            .unwrap();
        assert!(identities.verify("tab-1", &token));
        assert_eq!(
            identities.project_root("tab-1").as_deref(),
            Some("/tmp/project")
        );
    }

    #[test]
    fn reissuing_invalidates_the_previous_token() {
        let identities = SessionIdentities::default();
        let first = identities.issue("tab-1", None);
        let old = first
            .iter()
            .find(|(key, _)| key == ENV_TOKEN)
            .map(|(_, value)| value.clone())
            .unwrap();

        identities.issue("tab-1", None);

        // PTY 重启后，重启前那个进程不该还能以这条会话的身份说话。
        assert!(!identities.verify("tab-1", &old));
    }

    #[test]
    fn a_token_from_another_session_is_rejected() {
        let identities = SessionIdentities::default();
        identities.issue("tab-1", None);
        let other = identities.issue("tab-2", None);
        let other_token = other
            .iter()
            .find(|(key, _)| key == ENV_TOKEN)
            .map(|(_, value)| value.clone())
            .unwrap();

        // 抄到别人的 token 也不能冒充成 tab-1。
        assert!(!identities.verify("tab-1", &other_token));
        assert!(identities.verify("tab-2", &other_token));
    }

    #[test]
    fn revoking_stops_further_access() {
        let identities = SessionIdentities::default();
        let env = identities.issue("tab-1", None);
        let token = env
            .iter()
            .find(|(key, _)| key == ENV_TOKEN)
            .map(|(_, value)| value.clone())
            .unwrap();

        identities.revoke("tab-1");

        assert!(!identities.verify("tab-1", &token));
    }

    #[test]
    fn unknown_sessions_never_verify() {
        let identities = SessionIdentities::default();
        assert!(!identities.verify("nobody", ""));
        assert!(!identities.verify("nobody", "guessed"));
    }

    #[test]
    fn no_project_means_no_project_env_var() {
        let identities = SessionIdentities::default();
        let env = identities.issue("tab-1", None);
        // 没打开项目时不该注入一个空字符串，让 CLI 能直接判断有没有。
        assert!(!env.iter().any(|(key, _)| key == ENV_PROJECT));
    }
}
