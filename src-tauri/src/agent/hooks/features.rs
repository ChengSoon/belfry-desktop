use crate::agent::AgentKind;

pub(crate) fn supported(kind: AgentKind, version: Option<&str>) -> bool {
    let minimum = match kind {
        AgentKind::Codex => (0, 154, 0),
        AgentKind::Claude => (2, 1, 201),
        // Pi 没有 Hook 接口，任何版本都不声明 structured_state。
        AgentKind::Pi => return false,
    };
    version
        .and_then(|text| text.split_whitespace().find_map(parse))
        .is_some_and(|version| version >= minimum)
}

fn parse(value: &str) -> Option<(u32, u32, u32)> {
    let mut parts = value.trim_start_matches('v').split('.');
    let version = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    parts.next().is_none().then_some(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_verified_cli_versions_advertise_structured_state() {
        assert!(supported(AgentKind::Codex, Some("codex-cli 0.154.0")));
        assert!(supported(AgentKind::Claude, Some("2.1.201 (Claude Code)")));
        assert!(supported(AgentKind::Claude, Some("2.2.0 (Claude Code)")));
        assert!(!supported(AgentKind::Codex, Some("codex-cli 0.120.0")));
        assert!(!supported(AgentKind::Claude, Some("2.1.1 (Claude Code)")));
        assert!(!supported(AgentKind::Codex, None));
        assert!(!supported(AgentKind::Codex, Some("custom-dev-build")));
    }
}
