use super::*;
use serde_json::json;
use std::cell::Cell;

#[derive(Default)]
struct FakeKeys {
    key: RefCell<Option<secrets::MasterKey>>,
    denied: Cell<bool>,
    fail_create: Cell<bool>,
    corrupt_create: Cell<bool>,
    creates: Cell<usize>,
}
impl KeyStore for FakeKeys {
    fn read(&self) -> Result<Option<secrets::MasterKey>, AppError> {
        if self.denied.get() {
            return Err(unavailable());
        }
        Ok(self.key.borrow().clone())
    }
    fn create(&self, key: &secrets::MasterKey) -> Result<(), AppError> {
        if self.fail_create.get() {
            return Err(unavailable());
        }
        self.creates.set(self.creates.get() + 1);
        *self.key.borrow_mut() = Some(key.clone());
        if self.corrupt_create.get() {
            self.key.borrow_mut().as_mut().unwrap()[0] ^= 1;
        }
        Ok(())
    }
}
#[derive(Default)]
struct FakeFiles {
    files: RefCell<BTreeMap<String, Vec<u8>>>,
    fail_ciphertext: Cell<bool>,
    corrupt_write: Cell<bool>,
    fail_commit: Cell<bool>,
    fail_cleanup: Cell<bool>,
    fail_after_commit: Cell<bool>,
    writes: Cell<usize>,
}
impl Files for FakeFiles {
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>, AppError> {
        Ok(self.files.borrow().get(name).cloned())
    }
    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), AppError> {
        self.writes.set(self.writes.get() + 1);
        if (name == FILE && self.fail_commit.get()) || (name != FILE && self.fail_ciphertext.get())
        {
            return Err(disk_error());
        }
        let mut bytes = bytes.to_vec();
        if name != FILE && self.corrupt_write.get() {
            *bytes.last_mut().unwrap() ^= 1;
        }
        self.files.borrow_mut().insert(name.into(), bytes);
        if name == FILE && self.fail_after_commit.get() {
            return Err(disk_error());
        }
        Ok(())
    }
    fn vault_files(&self) -> Result<Vec<String>, AppError> {
        Ok(self
            .files
            .borrow()
            .keys()
            .filter(|k| k.starts_with("provider-vault/"))
            .cloned()
            .collect())
    }
    fn remove(&self, name: &str) -> Result<(), AppError> {
        if self.fail_cleanup.get() {
            return Err(disk_error());
        }
        self.files.borrow_mut().remove(name);
        Ok(())
    }
    fn confirm_commit(&self) -> Result<(), AppError> {
        if self.fail_after_commit.get() {
            Err(disk_error())
        } else {
            Ok(())
        }
    }
}
#[derive(Default)]
struct Fixture {
    fs: FakeFiles,
    keys: FakeKeys,
}
impl Fixture {
    fn engine(&self) -> Engine<'_> {
        Engine {
            fs: &self.fs,
            keys: &self.keys,
        }
    }
    fn legacy(&self) -> Vec<u8> {
        let bytes = serde_json::to_vec(&json!({
            "version":1,
            "agents": {
                "codex": {"providers": [{"id":"one", "name":"Synthetic", "baseUrl":"https://example.invalid",
                    "apiKey":"synthetic-api-secret", "createdAt":1}], "currentId":"one"},
                "future": {"providers": [{"id":"future-id", "name":"Future", "baseUrl":"https://example.invalid",
                    "apiKey":"synthetic-future-secret", "model":"future-model", "createdAt":2}], "currentId":"future-id"}
            },
            "codexOfficialAuth":{"tokens":{"access_token":"synthetic-oauth-secret"}, "futureField":[1,true,null]}
        })).unwrap();
        self.fs
            .files
            .borrow_mut()
            .insert(FILE.into(), bytes.clone());
        bytes
    }
    fn metadata(&self) -> Metadata {
        match migration::parse(&self.fs.read(FILE).unwrap().unwrap()).unwrap() {
            Parsed::Current(metadata) => metadata,
            _ => panic!("expected v2"),
        }
    }
    fn no_plaintext(&self) {
        for bytes in self.fs.files.borrow().values() {
            let text = String::from_utf8_lossy(bytes);
            assert!(!text.contains("synthetic-api-secret"));
            assert!(!text.contains("synthetic-oauth-secret"));
            assert!(!text.contains("synthetic-future-secret"));
        }
    }
}

#[test]
fn storage_keys_are_independent_of_the_binary_name() {
    assert_eq!(storage_key(AgentKind::Codex), "codex");
    assert_eq!(storage_key(AgentKind::Claude), "claude");
    assert_eq!(StoreFile::default().version, 2);
}

#[test]
fn migration_is_encrypted_lazy_idempotent_and_preserves_unknown_agents() {
    let f = Fixture::default();
    f.legacy();
    let store = f.engine().load().unwrap();
    f.no_plaintext();
    assert!(
        store.agent(AgentKind::Codex).providers[0]
            .api_key
            .is_empty()
    );
    assert!(store.codex_official_auth.is_none());
    assert!(store.has_api_key(AgentKind::Codex, "one"));
    assert_eq!(
        store.agents["future"].current_id.as_deref(),
        Some("future-id")
    );
    assert_eq!(store.agents["future"].providers[0].model, "future-model");
    assert!(store.agents["future"].providers[0].api_key.is_empty());
    let before = f.fs.files.borrow().clone();
    let restarted = f.engine().load().unwrap();
    assert_eq!(*f.fs.files.borrow(), before);
    assert_eq!(f.keys.creates.get(), 1);
    assert_eq!(
        restarted
            .resolve_with(&f.engine(), AgentKind::Codex, "one")
            .unwrap()
            .api_key,
        "synthetic-api-secret"
    );
    assert!(
        restarted.agent(AgentKind::Codex).providers[0]
            .api_key
            .is_empty()
    );
    assert!(!format!("{store:?}").contains("synthetic"));
}

#[test]
fn unknown_agents_in_the_file_survive_a_round_trip() {
    let f = Fixture::default();
    f.fs.files.borrow_mut().insert(
        FILE.into(),
        br#"{"version":1,"agents":{"future":{"providers":[],"currentId":"x"}}}"#.to_vec(),
    );
    let store = f.engine().load().unwrap();
    f.engine().save(&store, false).unwrap();
    assert_eq!(
        f.engine().load().unwrap().agents["future"]
            .current_id
            .as_deref(),
        Some("x")
    );
}

#[test]
fn api_update_preserve_clear_delete_and_stable_references() {
    let f = Fixture::default();
    f.legacy();
    let mut store = f.engine().load().unwrap();
    let reference = f.metadata().agents["codex"].providers[0]
        .api_key_ref
        .clone();
    store.agent_mut(AgentKind::Codex).providers[0].name = "renamed".into();
    f.engine().save(&store, false).unwrap();
    assert_eq!(
        store
            .resolve_with(&f.engine(), AgentKind::Codex, "one")
            .unwrap()
            .api_key,
        "synthetic-api-secret"
    );
    store.agent_mut(AgentKind::Codex).providers[0].api_key = "synthetic-replacement".into();
    f.engine().save(&store, false).unwrap();
    assert_eq!(
        f.metadata().agents["codex"].providers[0].api_key_ref,
        reference
    );
    let mut store = f.engine().load().unwrap();
    assert_eq!(
        store
            .resolve_with(&f.engine(), AgentKind::Codex, "one")
            .unwrap()
            .api_key,
        "synthetic-replacement"
    );
    store.clear_api_key(AgentKind::Codex, "one");
    assert!(!store.has_api_key(AgentKind::Codex, "one"));
    f.engine().save(&store, false).unwrap();
    assert!(
        store
            .resolve_with(&f.engine(), AgentKind::Codex, "one")
            .unwrap()
            .api_key
            .is_empty()
    );
    store.agent_mut(AgentKind::Codex).providers.clear();
    f.engine().save(&store, false).unwrap();
    let payload = f.engine().open(&f.metadata()).unwrap();
    assert!(!payload.secrets.contains_key(reference.as_ref().unwrap()));
    assert_eq!(f.fs.vault_files().unwrap().len(), 1);
    f.no_plaintext();
}

#[test]
fn official_auth_untouched_preserved_then_hydrated_cleared_and_replaced() {
    let f = Fixture::default();
    f.legacy();
    let store = f.engine().load().unwrap();
    let original_ref = f.metadata().codex_official_auth_ref;
    assert!(store.codex_official_auth.is_none());
    f.engine().save(&store, false).unwrap();
    assert_eq!(f.metadata().codex_official_auth_ref, original_ref);
    let mut store = f.engine().load().unwrap();
    store.resolve_official_with(&f.engine()).unwrap();
    assert_eq!(
        store.codex_official_auth.as_ref().unwrap()["tokens"]["access_token"],
        "synthetic-oauth-secret"
    );
    assert_eq!(
        store.codex_official_auth.as_ref().unwrap()["futureField"],
        json!([1, true, null])
    );
    store.codex_official_auth = None;
    store.resolve_official_with(&f.engine()).unwrap(); // must not rehydrate after clear
    f.engine().save(&store, false).unwrap();
    assert!(f.metadata().codex_official_auth_ref.is_none());
    let mut store = f.engine().load().unwrap();
    store.codex_official_auth = Some(json!({"tokens":{"access_token":"synthetic-new-oauth"}}));
    f.engine().save(&store, false).unwrap();
    let mut store = f.engine().load().unwrap();
    store.resolve_official_with(&f.engine()).unwrap();
    assert_eq!(
        store.codex_official_auth.unwrap()["tokens"]["access_token"],
        "synthetic-new-oauth"
    );
}

#[test]
fn large_oauth_lives_in_ciphertext_not_os_entry() {
    let f = Fixture::default();
    let large = "synthetic-large-oauth-".repeat(100_000);
    let mut store = StoreFile::default();
    store.codex_official_auth = Some(json!({"tokens":{"access_token":large}}));
    f.engine().save(&store, false).unwrap();
    assert_eq!(f.keys.key.borrow().as_ref().unwrap().len(), 32);
    assert!(
        f.fs.read(&vault_file(&f.metadata().vault))
            .unwrap()
            .unwrap()
            .len()
            > 1_000_000
    );
    let mut store = f.engine().load().unwrap();
    store.resolve_official_with(&f.engine()).unwrap();
    assert_eq!(
        store.codex_official_auth.unwrap()["tokens"]["access_token"]
            .as_str()
            .unwrap()
            .len(),
        large.len()
    );
}

#[test]
fn strict_legacy_parse_rejects_unknown_fields_shapes_versions_and_corruption() {
    for input in [
        "",
        " ",
        "{broken",
        r#"{"version":99,"agents":{}}"#,
        r#"{"version":1,"agents":{},"unknownSecret":"synthetic-sensitive"}"#,
        r#"{"version":1,"agents":{"future":{"unknownSecret":"synthetic-sensitive"}}}"#,
        r#"{"version":1,"agents":{"codex":{"providers":[{"id":"p","name":"p","baseUrl":"https://x","apiKey":{},"createdAt":1}]}}}"#,
        r#"{"version":1,"codexOfficialAuth":"synthetic-sensitive"}"#,
        r#"{"version":1,"codexOfficialAuth":["synthetic-sensitive"]}"#,
        r#"{"version":1,"agents":{"future":{"providers":[{"id":"p","name":"p","baseUrl":"https://x","apiKey":"key","createdAt":1,"extraToken":"synthetic-sensitive"}]}}}"#,
        r#"{"version":1,"version":2,"agents":{}}"#,
        r#"{"version":1,"agents":{"future":{},"future":{}}}"#,
        r#"{"version":1,"codexOfficialAuth":{"token":"synthetic-sensitive","token":"other"}}"#,
    ] {
        let f = Fixture::default();
        f.fs.files
            .borrow_mut()
            .insert(FILE.into(), input.as_bytes().to_vec());
        let error = f.engine().load().unwrap_err();
        assert!(!error.message.contains("synthetic-sensitive"));
        assert_eq!(f.fs.read(FILE).unwrap().unwrap(), input.as_bytes());
        assert_eq!(f.keys.creates.get(), 0);
        assert_eq!(f.fs.writes.get(), 0);
    }
}

#[test]
fn migration_failures_keep_old_primary_without_plaintext_backups() {
    for fault in ["denied", "create", "ciphertext", "verify", "commit"] {
        let f = Fixture::default();
        let old = f.legacy();
        match fault {
            "denied" => f.keys.denied.set(true),
            "create" => f.keys.fail_create.set(true),
            "ciphertext" => f.fs.fail_ciphertext.set(true),
            "verify" => f.fs.corrupt_write.set(true),
            "commit" => f.fs.fail_commit.set(true),
            _ => unreachable!(),
        }
        assert!(f.engine().load().is_err());
        assert_eq!(f.fs.read(FILE).unwrap().unwrap(), old);
        for (name, bytes) in f.fs.files.borrow().iter() {
            if name != FILE {
                assert!(!String::from_utf8_lossy(bytes).contains("synthetic-api-secret"));
            }
        }
        f.keys.denied.set(false);
        f.keys.fail_create.set(false);
        f.fs.fail_ciphertext.set(false);
        f.fs.corrupt_write.set(false);
        f.fs.fail_commit.set(false);
        f.engine().load().unwrap();
        assert_eq!(f.keys.creates.get(), 1);
        assert_eq!(f.fs.vault_files().unwrap().len(), 1);
        f.no_plaintext();
    }
}

#[test]
fn failed_update_commit_keeps_old_referenced_generation_and_retries() {
    let f = Fixture::default();
    f.legacy();
    let mut store = f.engine().load().unwrap();
    let primary = f.fs.read(FILE).unwrap().unwrap();
    let old_vault = vault_file(&f.metadata().vault);
    let ciphertext = f.fs.read(&old_vault).unwrap().unwrap();
    store.agent_mut(AgentKind::Codex).providers[0].api_key = "synthetic-update".into();
    f.fs.fail_commit.set(true);
    assert!(f.engine().save(&store, false).is_err());
    assert_eq!(f.fs.read(FILE).unwrap().unwrap(), primary);
    assert_eq!(f.fs.read(&old_vault).unwrap().unwrap(), ciphertext);
    // Simulates restart after ciphertext write but before metadata commit.
    let restarted = f.engine().load().unwrap();
    assert_eq!(
        restarted
            .resolve_with(&f.engine(), AgentKind::Codex, "one")
            .unwrap()
            .api_key,
        "synthetic-api-secret"
    );
    f.fs.fail_commit.set(false);
    f.engine().save(&store, false).unwrap();
    assert!(f.fs.read(&old_vault).unwrap().is_none());
    assert_eq!(
        f.engine()
            .load()
            .unwrap()
            .resolve_with(&f.engine(), AgentKind::Codex, "one")
            .unwrap()
            .api_key,
        "synthetic-update"
    );
}

#[test]
fn orphan_cleanup_failure_is_retried_on_load_and_save() {
    let f = Fixture::default();
    f.legacy();
    let store = f.engine().load().unwrap();
    f.fs.fail_cleanup.set(true);
    f.engine().save(&store, false).unwrap();
    assert_eq!(f.fs.vault_files().unwrap().len(), 2);
    f.fs.fail_cleanup.set(false);
    let store = f.engine().load().unwrap();
    assert_eq!(f.fs.vault_files().unwrap().len(), 1);
    f.fs.fail_cleanup.set(true);
    f.engine().save(&store, false).unwrap();
    f.fs.fail_cleanup.set(false);
    f.engine().save(&store, false).unwrap();
    assert_eq!(f.fs.vault_files().unwrap().len(), 1);
}

#[test]
fn missing_key_ciphertext_reference_and_auth_failure_fail_closed() {
    for fault in [
        "key",
        "denied",
        "ciphertext",
        "reference",
        "auth",
        "wrong-key",
    ] {
        let f = Fixture::default();
        f.legacy();
        let store = f.engine().load().unwrap();
        let mut metadata = f.metadata();
        match fault {
            "key" => *f.keys.key.borrow_mut() = None,
            "denied" => f.keys.denied.set(true),
            "ciphertext" => {
                f.fs.files.borrow_mut().remove(&vault_file(&metadata.vault));
            }
            "reference" => {
                metadata.agents.get_mut("codex").unwrap().providers[0].api_key_ref =
                    Some("a".repeat(32));
                f.fs.files
                    .borrow_mut()
                    .insert(FILE.into(), serde_json::to_vec(&metadata).unwrap());
            }
            "auth" => {
                *f.fs
                    .files
                    .borrow_mut()
                    .get_mut(&vault_file(&metadata.vault))
                    .unwrap()
                    .last_mut()
                    .unwrap() ^= 1;
            }
            "wrong-key" => *f.keys.key.borrow_mut() = Some(Zeroizing::new([42; 32])),
            _ => unreachable!(),
        }
        let before = f.fs.files.borrow().clone();
        assert!(f.engine().load().is_err());
        assert!(f.engine().available(&store).is_err());
        assert!(f.engine().save(&store, false).is_err());
        assert_eq!(*f.fs.files.borrow(), before);
        assert_eq!(f.keys.creates.get(), 1); // missing must NEVER create a replacement
    }
}

#[test]
fn stale_snapshot_cannot_overwrite_new_commit() {
    let f = Fixture::default();
    f.legacy();
    let store = f.engine().load().unwrap();
    let stale = store.clone();
    f.engine().save(&store, false).unwrap();
    let before = f.fs.files.borrow().clone();
    assert!(f.engine().save(&stale, false).is_err());
    assert_eq!(*f.fs.files.borrow(), before);
}

#[test]
fn interrupted_initial_commit_with_missing_master_never_rekeys() {
    let f = Fixture::default();
    let store = StoreFile::default();
    f.fs.fail_commit.set(true);
    assert!(f.engine().save(&store, false).is_err());
    assert!(f.fs.read(FILE).unwrap().is_none());
    assert_eq!(f.fs.vault_files().unwrap().len(), 1);
    *f.keys.key.borrow_mut() = None;
    assert!(f.engine().load().is_err());
    assert!(f.engine().save(&store, false).is_err());
    assert_eq!(f.keys.creates.get(), 1);
}

#[test]
fn aead_binds_generation_and_never_emits_plaintext() {
    let key = Zeroizing::new([7; 32]);
    let bytes = secrets::encrypt(&key, "generation-a", b"synthetic-secret").unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("synthetic-secret"));
    assert!(secrets::decrypt(&key, "generation-b", &bytes).is_err());
    assert_eq!(
        &*secrets::decrypt(&key, "generation-a", &bytes).unwrap(),
        b"synthetic-secret"
    );
}

#[test]
fn uncertain_commit_retains_both_generations_until_durability_is_confirmed() {
    let f = Fixture::default();
    f.legacy();
    let mut store = f.engine().load().unwrap();
    let old_vault = vault_file(&f.metadata().vault);
    store.agent_mut(AgentKind::Codex).providers[0].api_key = "synthetic-after-commit".into();
    f.fs.fail_after_commit.set(true);
    assert!(f.engine().save(&store, false).is_err());
    assert_ne!(vault_file(&f.metadata().vault), old_vault);
    assert_eq!(f.fs.vault_files().unwrap().len(), 2);
    assert!(f.engine().load().is_err());
    assert!(f.fs.read(&old_vault).unwrap().is_some());
    f.fs.fail_after_commit.set(false);
    let recovered = f.engine().load().unwrap();
    assert_eq!(
        recovered
            .resolve_with(&f.engine(), AgentKind::Codex, "one")
            .unwrap()
            .api_key,
        "synthetic-after-commit"
    );
    assert_eq!(f.fs.vault_files().unwrap().len(), 1);
}

#[test]
fn master_creation_is_read_back_before_any_ciphertext_commit() {
    let f = Fixture::default();
    let old = f.legacy();
    f.keys.corrupt_create.set(true);
    assert!(f.engine().load().is_err());
    assert_eq!(f.fs.read(FILE).unwrap().unwrap(), old);
    assert_eq!(f.fs.writes.get(), 0);
    assert!(f.fs.vault_files().unwrap().is_empty());
}

#[test]
fn swapped_provider_reference_and_unknown_v2_fields_are_rejected() {
    let f = Fixture::default();
    f.legacy();
    f.engine().load().unwrap();
    let original = f.fs.read(FILE).unwrap().unwrap();
    let mut metadata = f.metadata();
    let future = metadata.agents["future"].providers[0].api_key_ref.clone();
    let codex = metadata.agents["codex"].providers[0].api_key_ref.clone();
    metadata.agents.get_mut("codex").unwrap().providers[0].api_key_ref = future;
    metadata.agents.get_mut("future").unwrap().providers[0].api_key_ref = codex;
    f.fs.files
        .borrow_mut()
        .insert(FILE.into(), serde_json::to_vec(&metadata).unwrap());
    assert!(f.engine().load().is_err());
    let mut value: Value = serde_json::from_slice(&original).unwrap();
    value["agents"]["codex"]["providers"][0]["apiKey"] = json!("synthetic-sensitive");
    f.fs.files
        .borrow_mut()
        .insert(FILE.into(), serde_json::to_vec(&value).unwrap());
    let error = f.engine().load().unwrap_err();
    assert!(!error.message.contains("synthetic-sensitive"));
}

#[test]
fn official_backup_commit_preserves_pending_update_clear_and_add_until_final_save() {
    for operation in ["update", "clear", "add"] {
        let f = Fixture::default();
        f.legacy();
        let mut store = f.engine().load().unwrap();
        store.resolve_official_with(&f.engine()).unwrap();
        let old_generation = store.refs.borrow().vault.clone();
        let expected_key = match operation {
            "update" => {
                let provider = &mut store.agent_mut(AgentKind::Codex).providers[0];
                provider.api_key = "synthetic-pending-update".into();
                provider.model = "pending-model".into();
                "synthetic-pending-update"
            }
            "clear" => {
                store.clear_api_key(AgentKind::Codex, "one");
                ""
            }
            "add" => {
                let mut provider = store.agent(AgentKind::Codex).providers[0].clone();
                provider.id = "added".into();
                provider.api_key = "synthetic-pending-add".into();
                store.agent_mut(AgentKind::Codex).providers.push(provider);
                "synthetic-pending-add"
            }
            _ => unreachable!(),
        };
        store.agent_mut(AgentKind::Codex).current_id = None;
        let pending_api_refs = store.refs.borrow().api_keys.clone();
        let backup = Some(json!({"tokens":{"access_token":"synthetic-backup-before-cli"}}));
        store
            .persist_official_backup_with(&f.engine(), &backup)
            .unwrap();
        assert_ne!(store.refs.borrow().vault, old_generation);
        assert_eq!(store.refs.borrow().api_keys, pending_api_refs);
        assert_eq!(store.codex_official_auth, backup);

        // If the external CLI write fails now, dropping pending state leaves the
        // old selection/provider/key on disk, but the new OAuth backup is durable.
        let mut durable = f.engine().load().unwrap();
        assert_eq!(
            durable.agent(AgentKind::Codex).current_id.as_deref(),
            Some("one")
        );
        assert_eq!(durable.agent(AgentKind::Codex).providers.len(), 1);
        assert!(
            durable.agent(AgentKind::Codex).providers[0]
                .model
                .is_empty()
        );
        assert_eq!(
            durable
                .resolve_with(&f.engine(), AgentKind::Codex, "one")
                .unwrap()
                .api_key,
            "synthetic-api-secret"
        );
        durable.resolve_official_with(&f.engine()).unwrap();
        assert_eq!(durable.codex_official_auth, backup);

        let selected = if operation == "add" { "added" } else { "one" };
        assert_eq!(
            store
                .resolve_with(&f.engine(), AgentKind::Codex, selected)
                .unwrap()
                .api_key,
            expected_key
        );
        f.engine().available(&store).unwrap();
        f.engine().save(&store, false).unwrap(); // must not fail on stale generation
        let mut final_store = f.engine().load().unwrap();
        assert!(final_store.agent(AgentKind::Codex).current_id.is_none());
        assert_eq!(
            final_store
                .resolve_with(&f.engine(), AgentKind::Codex, selected)
                .unwrap()
                .api_key,
            expected_key
        );
        if operation == "update" {
            assert_eq!(
                final_store.agent(AgentKind::Codex).providers[0].model,
                "pending-model"
            );
        }
        final_store.resolve_official_with(&f.engine()).unwrap();
        assert_eq!(final_store.codex_official_auth, backup);
        assert_eq!(f.fs.vault_files().unwrap().len(), 1);
        f.no_plaintext();
    }
}

#[test]
fn official_backup_before_first_import_does_not_commit_imported_provider_early() {
    let f = Fixture::default();
    let mut store = f.engine().load().unwrap();
    store
        .agent_mut(AgentKind::Codex)
        .providers
        .push(ProviderConfig {
            id: "imported".into(),
            name: "Synthetic import".into(),
            base_url: "https://example.invalid".into(),
            api_key: "synthetic-imported-key".into(),
            model: "imported-model".into(),
            created_at: 1,
        });
    store.agent_mut(AgentKind::Codex).current_id = Some("imported".into());
    let backup = Some(json!({"tokens":{"access_token":"synthetic-import-backup"}}));
    store
        .persist_official_backup_with(&f.engine(), &backup)
        .unwrap();
    assert!(f.metadata().agents.is_empty());
    assert!(store.refs.borrow().api_keys.is_empty());
    assert!(store.has_api_key(AgentKind::Codex, "imported"));
    assert_eq!(
        store
            .resolve_with(&f.engine(), AgentKind::Codex, "imported")
            .unwrap()
            .api_key,
        "synthetic-imported-key"
    );
    f.engine().save(&store, false).unwrap();
    let mut final_store = f.engine().load().unwrap();
    assert_eq!(
        final_store.agent(AgentKind::Codex).current_id.as_deref(),
        Some("imported")
    );
    assert_eq!(
        final_store
            .resolve_with(&f.engine(), AgentKind::Codex, "imported")
            .unwrap()
            .api_key,
        "synthetic-imported-key"
    );
    final_store.resolve_official_with(&f.engine()).unwrap();
    assert_eq!(final_store.codex_official_auth, backup);
}

#[test]
fn official_backup_commit_failure_preserves_original_refs_and_pending_state() {
    let f = Fixture::default();
    f.legacy();
    let mut store = f.engine().load().unwrap();
    store.resolve_official_with(&f.engine()).unwrap();
    store.clear_api_key(AgentKind::Codex, "one");
    store.agent_mut(AgentKind::Codex).current_id = None;
    let before = store.refs.borrow().clone();
    let original_auth = store.codex_official_auth.clone();
    let primary = f.fs.read(FILE).unwrap().unwrap();
    f.fs.fail_commit.set(true);
    let backup = Some(json!({"tokens":{"access_token":"synthetic-failed-backup"}}));
    assert!(
        store
            .persist_official_backup_with(&f.engine(), &backup)
            .is_err()
    );
    assert_eq!(store.refs.borrow().vault, before.vault);
    assert_eq!(store.refs.borrow().official, before.official);
    assert_eq!(store.refs.borrow().api_keys, before.api_keys);
    assert_eq!(store.codex_official_auth, original_auth);
    assert!(store.agent(AgentKind::Codex).current_id.is_none());
    assert_eq!(f.fs.read(FILE).unwrap().unwrap(), primary);
    f.fs.fail_commit.set(false);
    store
        .persist_official_backup_with(&f.engine(), &backup)
        .unwrap();
    f.engine().save(&store, false).unwrap();
    assert!(
        !f.engine()
            .load()
            .unwrap()
            .has_api_key(AgentKind::Codex, "one")
    );
}

#[test]
fn explicit_none_backup_clears_auth_and_does_not_reintroduce_it_on_final_save() {
    let f = Fixture::default();
    f.legacy();
    let mut store = f.engine().load().unwrap();
    store.resolve_official_with(&f.engine()).unwrap();
    store
        .persist_official_backup_with(&f.engine(), &None)
        .unwrap();
    assert!(store.codex_official_auth.is_none());
    assert!(store.refs.borrow().official.is_none());
    store.resolve_official_with(&f.engine()).unwrap();
    f.engine().save(&store, false).unwrap();
    assert!(f.metadata().codex_official_auth_ref.is_none());
}

#[test]
fn official_backup_rejects_unrelated_stale_store_instead_of_rebasing_it() {
    let f = Fixture::default();
    f.legacy();
    let store = f.engine().load().unwrap();
    let mut stale = store.clone();
    f.engine().save(&store, false).unwrap();
    let before = f.fs.files.borrow().clone();
    assert!(
        stale
            .persist_official_backup_with(&f.engine(), &None)
            .is_err()
    );
    assert_eq!(*f.fs.files.borrow(), before);
}
