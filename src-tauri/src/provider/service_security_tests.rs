//! Synthetic-data tests: never resolve the user's application directory or CLI config.
use super::*;

fn fixture() -> (StoreFile, ProviderDraft) {
    let mut store = StoreFile::default();
    store
        .agent_mut(AgentKind::Claude)
        .providers
        .push(ProviderConfig {
            id: "synthetic".into(),
            name: "Test".into(),
            base_url: "https://example.invalid".into(),
            api_key: "synthetic-private-key".into(),
            model: "test-model".into(),
            created_at: 1,
        });
    let draft = ProviderDraft {
        id: Some("synthetic".into()),
        name: "Renamed".into(),
        base_url: "https://example.invalid".into(),
        api_key: String::new(),
        api_key_action: ApiKeyAction::Keep,
        model: String::new(),
    };
    (store, draft)
}

#[test]
fn catalog_and_debug_do_not_disclose_credentials() {
    let (store, mut draft) = fixture();
    let public = serde_json::to_value(build(&store)).unwrap();
    let provider = &public["agents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["kind"] == "claude")
        .unwrap()["providers"][0];
    assert_eq!(provider["hasApiKey"], true);
    assert!(provider.get("apiKey").is_none());
    assert!(!public.to_string().contains("synthetic-private-key"));
    draft.api_key = "synthetic-private-key".into();
    let preview = ConfigFilePreview {
        path: "test".into(),
        format: "json".into(),
        content: draft.api_key.clone(),
    };
    assert!(
        !format!("{draft:?} {preview:?} {:?}", store.agent(AgentKind::Claude))
            .contains("synthetic-private-key")
    );
}

#[test]
fn key_actions_are_explicit_and_do_not_accept_ambiguous_empty_values() {
    let (_, mut draft) = fixture();
    assert!(draft.validate().is_ok());
    draft.api_key_action = ApiKeyAction::Replace;
    assert!(draft.validate().is_err());
    draft.api_key = "  ".into();
    assert!(draft.validate().is_err());
    draft.api_key = "synthetic-new-key".into();
    assert!(draft.validate().is_ok());
    draft.api_key_action = ApiKeyAction::Clear;
    assert!(draft.validate().is_err());
    draft.api_key.clear();
    assert!(draft.validate().is_ok());
    draft.api_key_action = ApiKeyAction::Keep;
    draft.id = None;
    assert!(draft.validate().is_err());
    assert!(serde_json::from_value::<ProviderDraft>(serde_json::json!({
        "id": "synthetic", "name": "Test", "baseUrl": "https://example.invalid", "apiKey": "", "model": ""
    })).is_err(), "old clients must not silently clear keys");
}

#[test]
fn kept_keys_cannot_be_sent_to_changed_endpoints() {
    let (store, mut draft) = fixture();
    assert!(validate_kept_endpoint(&store, AgentKind::Claude, &draft).is_ok());
    draft.base_url = "https://other.invalid".into();
    assert!(validate_kept_endpoint(&store, AgentKind::Claude, &draft).is_err());
    draft.api_key_action = ApiKeyAction::Clear;
    assert!(validate_kept_endpoint(&store, AgentKind::Claude, &draft).is_ok());
    draft.api_key_action = ApiKeyAction::Replace;
    draft.api_key = "explicit-new-key".into();
    assert!(validate_kept_endpoint(&store, AgentKind::Claude, &draft).is_ok());
}

#[test]
fn sensitive_preview_requires_opt_in_before_any_file_read() {
    assert!(require_sensitive_preview(false).is_err());
    assert!(require_sensitive_preview(true).is_ok());
    for kind in AgentKind::ALL {
        assert!(config_files(kind, false).is_err());
    }
}

#[test]
fn explicit_live_clear_updates_configured_state() {
    let (mut store, _) = fixture();
    apply_live_to_store(
        &mut store,
        AgentKind::Claude,
        Some((
            "Test".into(),
            "https://example.invalid".into(),
            String::new(),
            "test-model".into(),
        )),
    );
    assert!(!store.has_api_key(AgentKind::Claude, "synthetic"));
}
