//! Explicit isolation path for comparing a managed Codex launch with plain `codex`.
//! This is a workaround/diagnostic switch, not an encrypted-reasoning repair.
use std::collections::HashMap;

pub(crate) const ENV: &str = "BELFRY_CODEX_NATIVE";

pub(crate) fn enabled(env: &HashMap<String, String>) -> bool {
    let value = env.get(ENV).cloned().or_else(|| std::env::var(ENV).ok());
    value.is_some_and(|value| value.trim() == "1")
}

/// Freeze the GUI's choice before handing the request to a longer-lived daemon.
/// In particular, an old daemon must not impose its inherited value on a new GUI.
pub(crate) fn freeze(env: &mut HashMap<String, String>) {
    let value = if enabled(env) { "1" } else { "0" };
    env.insert(ENV.into(), value.into());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_values_override_process_environment_and_survive_daemon_handoff() {
        for (input, expected) in [
            ("1", true),
            (" 1 ", true),
            ("0", false),
            ("", false),
            ("true", false),
        ] {
            let mut env = HashMap::from([(ENV.into(), input.into())]);
            assert_eq!(enabled(&env), expected);
            freeze(&mut env);
            assert_eq!(env.get(ENV).unwrap(), if expected { "1" } else { "0" });
            assert_eq!(enabled(&env), expected);
        }
    }
}
