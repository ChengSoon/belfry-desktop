use std::{fs, sync::atomic::Ordering};

use serde_json::{Value, json};

use super::super::contracts::CredentialEdit;
use super::fixture::*;

#[test]
fn a2a_vault_roundtrip_keeps_metadata_public_and_never_uses_the_os_keychain_in_tests() {
    let fixture = Fixture::new();
    let secret = "synthetic-a2a-private-token";
    let info = fixture.save(&draft("https://example.invalid", "bearer", Some(secret)));
    assert!(info.auth.has_credential);
    assert_eq!(fixture.keys.creates.load(Ordering::Acquire), 1);
    let resolved = fixture
        .store
        .resolve(&fixture.owner.root, &info.id)
        .unwrap();
    assert_eq!(resolved.secret.as_ref().unwrap().as_str(), secret);
    let metadata = fs::read(fixture.root.0.join("a2a/connections.json")).unwrap();
    assert!(!String::from_utf8_lossy(&metadata).contains(secret));
    let records: Value = serde_json::from_slice(&metadata).unwrap();
    assert!(records["connections"][0].get("credential").is_none());
    let reference = records["connections"][0]["credentialRef"].as_str().unwrap();
    let vault = fixture.root.0.join(format!("a2a/vault/{reference}.vault"));
    let cipher = fs::read(&vault).unwrap();
    assert!(cipher.starts_with(b"BELFRY-A2A-VAULT\x01"));
    assert!(!String::from_utf8_lossy(&cipher).contains(secret));
    assert!(!serde_json::to_string(&info).unwrap().contains(secret));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(vault).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(fixture.root.0.join("a2a/connections.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn a2a_keep_replace_clear_and_cross_project_edits_are_explicit() {
    let fixture = Fixture::new();
    let info = fixture.save(&draft(
        "https://example.invalid",
        "apiKey",
        Some("synthetic-first"),
    ));
    let mut keep = draft("https://example.invalid", "apiKey", None);
    keep.id = Some(info.id.clone());
    keep.auth.credential = CredentialEdit::Keep;
    let kept = fixture.save(&keep);
    assert_eq!(
        fixture
            .store
            .resolve(&fixture.owner.root, &kept.id)
            .unwrap()
            .secret
            .unwrap()
            .as_str(),
        "synthetic-first"
    );
    keep.interface_url = Some("https://different.invalid/rpc".into());
    assert_eq!(
        code(
            &fixture
                .runtime
                .save(&fixture.store, &fixture.owner.root, &keep)
                .unwrap_err()
        ),
        "A2A_CREDENTIAL_KEEP_INVALID"
    );
    keep.interface_url = None;
    keep.auth.header_name = Some("X-Another-Key".into());
    assert_eq!(
        code(
            &fixture
                .runtime
                .save(&fixture.store, &fixture.owner.root, &keep)
                .unwrap_err()
        ),
        "A2A_CREDENTIAL_KEEP_INVALID"
    );
    keep.auth.header_name = Some("X-API-Key".into());
    let other = fixture.other_project();
    assert_eq!(
        code(
            &fixture
                .runtime
                .save(&fixture.store, &other.root, &keep)
                .unwrap_err()
        ),
        "A2A_CONNECTION_NOT_FOUND"
    );
    keep.auth.credential = CredentialEdit::Replace {
        value: "synthetic-replacement".into(),
    };
    let replacement = fixture.save(&keep);
    assert_ne!(replacement.revision, kept.revision);
    assert_eq!(
        fixture
            .store
            .resolve(&fixture.owner.root, &replacement.id)
            .unwrap()
            .secret
            .unwrap()
            .as_str(),
        "synthetic-replacement"
    );
    keep.auth.credential = CredentialEdit::Clear;
    let cleared = fixture.save(&keep);
    assert!(!cleared.auth.has_credential);
    assert!(
        fixture
            .store
            .resolve(&fixture.owner.root, &cleared.id)
            .unwrap()
            .secret
            .is_none()
    );
    assert_eq!(
        fs::read_dir(fixture.root.0.join("a2a/vault"))
            .unwrap()
            .count(),
        0
    );
    fixture
        .runtime
        .remove(&fixture.store, &fixture.owner.root, &cleared.id)
        .unwrap();
    assert!(
        fixture
            .runtime
            .list(&fixture.store, &fixture.owner.root)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a2a_lost_keys_denied_storage_and_damaged_ciphertext_preserve_the_last_commit() {
    for damage in ["lost", "denied", "cipher"] {
        let fixture = Fixture::new();
        let info = fixture.save(&draft(
            "https://example.invalid",
            "bearer",
            Some("synthetic-existing"),
        ));
        let path = fixture.root.0.join("a2a/connections.json");
        let original = fs::read(&path).unwrap();
        match damage {
            "lost" => *fixture.keys.value.lock().unwrap() = None,
            "denied" => fixture.keys.denied.store(true, Ordering::Release),
            "cipher" => {
                let metadata: Value = serde_json::from_slice(&original).unwrap();
                let reference = metadata["connections"][0]["credentialRef"]
                    .as_str()
                    .unwrap();
                let path = fixture.root.0.join(format!("a2a/vault/{reference}.vault"));
                let mut bytes = fs::read(&path).unwrap();
                *bytes.last_mut().unwrap() ^= 1;
                fs::write(path, bytes).unwrap();
            }
            _ => unreachable!(),
        }
        assert_eq!(
            code(
                &fixture
                    .store
                    .resolve(&fixture.owner.root, &info.id)
                    .err()
                    .unwrap()
            ),
            "A2A_STORAGE_UNAVAILABLE"
        );
        let mut replacement = draft("https://example.invalid", "bearer", Some("synthetic-new"));
        replacement.id = Some(info.id);
        assert_eq!(
            code(
                &fixture
                    .runtime
                    .save(&fixture.store, &fixture.owner.root, &replacement)
                    .unwrap_err()
            ),
            "A2A_STORAGE_UNAVAILABLE"
        );
        assert_eq!(fs::read(path).unwrap(), original);
        assert_eq!(
            fixture.keys.creates.load(Ordering::Acquire),
            1,
            "lost keys must never be regenerated"
        );
    }
}

#[test]
fn a2a_ciphertext_binding_rejects_metadata_substitution_and_anonymous_needs_no_key() {
    let fixture = Fixture::new();
    fixture.keys.denied.store(true, Ordering::Release);
    let anonymous = fixture.save(&draft("https://example.invalid", "none", None));
    assert_eq!(fixture.keys.creates.load(Ordering::Acquire), 0);
    assert!(
        fixture
            .store
            .resolve(&fixture.owner.root, &anonymous.id)
            .unwrap()
            .secret
            .is_none()
    );
    fixture.keys.denied.store(false, Ordering::Release);
    let authenticated = fixture.save(&draft(
        "https://example.invalid",
        "bearer",
        Some("synthetic-bound-secret"),
    ));
    let path = fixture.root.0.join("a2a/connections.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let record = &mut value["connections"][1];
    record["cardUrl"] = json!("https://other.invalid/card");
    record["credentialOrigin"] = json!("https://other.invalid");
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(
        code(
            &fixture
                .store
                .resolve(&fixture.owner.root, &authenticated.id)
                .err()
                .unwrap()
        ),
        "A2A_STORAGE_UNAVAILABLE"
    );
}

#[cfg(unix)]
#[test]
fn a2a_secure_store_rejects_symlinked_metadata_and_vault_directories() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let info = fixture.save(&draft(
        "https://example.invalid",
        "bearer",
        Some("synthetic-token"),
    ));
    let base = fixture.root.0.join("a2a");
    let metadata = base.join("connections.json");
    let saved = base.join("saved.json");
    fs::rename(&metadata, &saved).unwrap();
    symlink(&saved, &metadata).unwrap();
    assert_eq!(
        code(
            &fixture
                .runtime
                .list(&fixture.store, &fixture.owner.root)
                .unwrap_err()
        ),
        "A2A_STORAGE_UNAVAILABLE"
    );
    fs::remove_file(&metadata).unwrap();
    fs::rename(saved, metadata).unwrap();
    let vault = base.join("vault");
    let elsewhere = base.join("elsewhere");
    fs::rename(&vault, &elsewhere).unwrap();
    symlink(&elsewhere, &vault).unwrap();
    assert_eq!(
        code(
            &fixture
                .store
                .resolve(&fixture.owner.root, &info.id)
                .err()
                .unwrap()
        ),
        "A2A_STORAGE_UNAVAILABLE"
    );
}
