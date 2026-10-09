//! Production disk + CLI adapters with a synthetic key store. No application/user paths.
use super::*;
use crate::provider::{claude, codex, pi, project};
use serde_json::json;

#[derive(Default)]
struct MemoryKey(RefCell<Option<secrets::MasterKey>>);
impl KeyStore for MemoryKey {
    fn read(&self) -> Result<Option<secrets::MasterKey>, AppError> {
        Ok(self.0.borrow().clone())
    }
    fn create(&self, key: &secrets::MasterKey) -> Result<(), AppError> {
        assert!(self.0.borrow().is_none());
        *self.0.borrow_mut() = Some(key.clone());
        Ok(())
    }
}
struct TempRoot(PathBuf);
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn assert_no_plaintext(root: &Path) {
    for entry in std::fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            assert_no_plaintext(&path);
        } else {
            let bytes = std::fs::read(path).unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains("synthetic-secret-"));
        }
    }
}

#[test]
fn disk_migration_switch_project_launch_and_official_restore_share_the_encrypted_store() {
    let root = TempRoot(
        std::env::temp_dir().join(format!("belfry-secure-path-{}", ulid::Ulid::generate())),
    );
    let files = LocalFiles(root.0.join("belfry-owned"));
    let keys = MemoryKey::default();
    let engine = Engine {
        fs: &files,
        keys: &keys,
    };
    let oauth = json!({"tokens": {"access_token": "synthetic-secret-live-oauth", "refresh_token": "synthetic-secret-refresh"}});
    let mut agents = serde_json::Map::new();
    for kind in AgentKind::ALL {
        let name = storage_key(kind);
        agents.insert(
            name.into(),
            json!({"providers": [{"id": name, "name": "Synthetic",
            "baseUrl": "https://example.invalid/v1", "apiKey": format!("synthetic-secret-{name}"),
            "model": "synthetic-model", "createdAt": 1}], "currentId": null}),
        );
    }
    files
        .write(
            FILE,
            &serde_json::to_vec(&json!({"version": 1, "agents": agents})).unwrap(),
        )
        .unwrap();
    let mut store = engine.load().unwrap();
    assert_no_plaintext(&files.0);
    assert_eq!(files.vault_files().unwrap().len(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(files.0.join(FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    // Switch global Codex: durable OAuth capture must precede overwriting the external files.
    let cli = root.0.join("external-codex");
    std::fs::create_dir_all(&cli).unwrap();
    std::fs::write(cli.join("config.toml"), "# preserve this comment\n").unwrap();
    std::fs::write(cli.join("auth.json"), oauth.to_string()).unwrap();
    let target = store
        .resolve_with(&engine, AgentKind::Codex, "codex")
        .unwrap();
    store.resolve_official_with(&engine).unwrap();
    let mut backup = store.codex_official_auth.take();
    codex::switch_in_with_backup(&cli, Some(&target), &mut backup, |pending| {
        store.persist_official_backup_with(&engine, pending)?;
        assert_eq!(engine.load()?.agent(AgentKind::Codex).current_id, None);
        let live: Value =
            serde_json::from_slice(&std::fs::read(cli.join("auth.json")).unwrap()).unwrap();
        assert_eq!(live, oauth);
        Ok(())
    })
    .unwrap();
    store.codex_official_auth = backup;
    store.agent_mut(AgentKind::Codex).current_id = Some("codex".into());
    engine.save(&store, false).unwrap();
    assert_eq!(
        engine
            .load()
            .unwrap()
            .agent(AgentKind::Codex)
            .current_id
            .as_deref(),
        Some("codex")
    );
    let live: Value =
        serde_json::from_slice(&std::fs::read(cli.join("auth.json")).unwrap()).unwrap();
    assert_eq!(live["OPENAI_API_KEY"], "synthetic-secret-codex"); // documented external plaintext exception

    // Restart, then resolve independently for project launch; metadata still contains no keys.
    let mut restarted = engine.load().unwrap();
    for kind in [AgentKind::Codex, AgentKind::Claude] {
        let name = storage_key(kind);
        assert!(restarted.agent(kind).providers[0].api_key.is_empty());
        let resolved = restarted.resolve_with(&engine, kind, name).unwrap();
        let overlay =
            project::prepare_synthetic(&root.0.join("external-project"), kind, &resolved).unwrap();
        assert!(!overlay.arguments.join(" ").contains("synthetic-secret-"));
        assert!(!format!("{overlay:?}").contains("synthetic-secret-"));
        let variable = if kind == AgentKind::Codex {
            "BELFRY_PROVIDER_API_KEY"
        } else {
            "ANTHROPIC_AUTH_TOKEN"
        };
        assert_eq!(
            overlay.environment[variable],
            format!("synthetic-secret-{name}")
        );
    }
    let claude_provider = restarted
        .resolve_with(&engine, AgentKind::Claude, "claude")
        .unwrap();
    let mut settings = json!({"custom": true});
    claude::apply(&mut settings, Some(&claude_provider)).unwrap();
    assert_eq!(
        settings["env"]["ANTHROPIC_AUTH_TOKEN"],
        "synthetic-secret-claude"
    );
    assert_eq!(settings["custom"], true);
    claude::apply(&mut settings, None).unwrap();
    assert!(!settings.to_string().contains("synthetic-secret-"));
    let pi_provider = restarted
        .resolve_with(&engine, AgentKind::Pi, "pi")
        .unwrap();
    let (mut models, mut pi_settings) = (json!({}), json!({}));
    pi::apply(&mut models, &mut pi_settings, Some(&pi_provider)).unwrap();
    assert!(models.to_string().contains("synthetic-secret-pi"));
    pi::apply(&mut models, &mut pi_settings, None).unwrap();
    assert!(!models.to_string().contains("synthetic-secret-"));

    // Official restore after restart consumes the encrypted backup only after external success.
    restarted.resolve_official_with(&engine).unwrap();
    let mut backup = restarted.codex_official_auth.take();
    codex::switch_in_with_backup(&cli, None, &mut backup, |_| {
        panic!("restoring must not recapture")
    })
    .unwrap();
    restarted.codex_official_auth = backup;
    restarted.agent_mut(AgentKind::Codex).current_id = None;
    engine.save(&restarted, false).unwrap();
    let restored: Value =
        serde_json::from_slice(&std::fs::read(cli.join("auth.json")).unwrap()).unwrap();
    assert_eq!(restored, oauth);
    let mut restarted = engine.load().unwrap();
    restarted.resolve_official_with(&engine).unwrap();
    assert!(restarted.codex_official_auth.is_none());

    // Real disk replace, explicit clear and deletion; no stale reference can resurrect a key.
    restarted.agent_mut(AgentKind::Codex).providers[0].api_key = "synthetic-secret-replaced".into();
    engine.save(&restarted, false).unwrap();
    let mut restarted = engine.load().unwrap();
    assert_eq!(
        restarted
            .resolve_with(&engine, AgentKind::Codex, "codex")
            .unwrap()
            .api_key,
        "synthetic-secret-replaced"
    );
    restarted.clear_api_key(AgentKind::Codex, "codex");
    engine.save(&restarted, false).unwrap();
    let mut restarted = engine.load().unwrap();
    let cleared = restarted
        .resolve_with(&engine, AgentKind::Codex, "codex")
        .unwrap();
    assert!(cleared.api_key.is_empty());
    assert!(project::prepare_synthetic(&root.0, AgentKind::Codex, &cleared).is_err());
    restarted.agent_mut(AgentKind::Codex).providers.clear();
    engine.save(&restarted, false).unwrap();
    assert!(
        engine
            .load()
            .unwrap()
            .resolve_with(&engine, AgentKind::Codex, "codex")
            .is_err()
    );
    assert_eq!(files.vault_files().unwrap().len(), 1);
    assert_no_plaintext(&files.0);
}
