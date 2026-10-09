//! Strict versioned metadata parsing. No permissive runtime contract is used on disk.
use super::{AgentProviders, ProviderConfig, References, StoreFile, VERSION};
use crate::terminal::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn invalid() -> AppError {
    AppError::invalid_argument("Provider 库格式未知或损坏；为避免丢失配置，已停止迁移和写入。")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyStore {
    version: u32,
    #[serde(default)]
    agents: BTreeMap<String, LegacyAgent>,
    #[serde(default)]
    codex_official_auth: Option<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyAgent {
    #[serde(default)]
    providers: Vec<LegacyProvider>,
    #[serde(default)]
    current_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyProvider {
    id: String,
    name: String,
    base_url: String,
    api_key: String,
    #[serde(default)]
    model: String,
    created_at: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Metadata {
    pub version: u32,
    pub vault: String,
    pub agents: BTreeMap<String, MetadataAgent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_official_auth_ref: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MetadataAgent {
    pub providers: Vec<MetadataProvider>,
    pub current_id: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MetadataProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_ref: Option<String>,
}

pub(super) enum Parsed {
    Legacy(StoreFile),
    Current(Metadata),
}

pub(super) fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// serde_json::Value/BTreeMap normally overwrite duplicate object keys. Reject
/// them recursively first, including unknown-agent maps and opaque OAuth objects,
/// so a migration can never silently discard an earlier credential value.
fn reject_duplicate_keys(bytes: &[u8]) -> Result<(), AppError> {
    use serde::de::{self, MapAccess, SeqAccess, Visitor};
    struct Checked;
    impl<'de> Deserialize<'de> for Checked {
        fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            d.deserialize_any(CheckedVisitor)
        }
    }
    struct CheckedVisitor;
    impl<'de> Visitor<'de> for CheckedVisitor {
        type Value = Checked;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("unambiguous JSON")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Checked, A::Error> {
            let mut keys = BTreeSet::new();
            while let Some(key) = map.next_key::<String>()? {
                if !keys.insert(key) {
                    return Err(de::Error::custom("duplicate field"));
                }
                map.next_value::<Checked>()?;
            }
            Ok(Checked)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Checked, A::Error> {
            while seq.next_element::<Checked>()?.is_some() {}
            Ok(Checked)
        }
        fn visit_bool<E: de::Error>(self, _: bool) -> Result<Checked, E> {
            Ok(Checked)
        }
        fn visit_i64<E: de::Error>(self, _: i64) -> Result<Checked, E> {
            Ok(Checked)
        }
        fn visit_u64<E: de::Error>(self, _: u64) -> Result<Checked, E> {
            Ok(Checked)
        }
        fn visit_f64<E: de::Error>(self, _: f64) -> Result<Checked, E> {
            Ok(Checked)
        }
        fn visit_str<E: de::Error>(self, _: &str) -> Result<Checked, E> {
            Ok(Checked)
        }
        fn visit_unit<E: de::Error>(self) -> Result<Checked, E> {
            Ok(Checked)
        }
    }
    serde_json::from_slice::<Checked>(bytes)
        .map(|_| ())
        .map_err(|_| invalid())
}

pub(super) fn parse(bytes: &[u8]) -> Result<Parsed, AppError> {
    reject_duplicate_keys(bytes)?;
    // The preliminary Value is only for version dispatch. Actual decoding below
    // rejects unknown fields and unsupported shapes at every metadata level.
    let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    match value.get("version").and_then(Value::as_u64) {
        Some(1) => {
            let legacy: LegacyStore = serde_json::from_slice(bytes).map_err(|_| invalid())?;
            if legacy.version != 1
                || legacy
                    .codex_official_auth
                    .as_ref()
                    .is_some_and(|v| !v.is_object())
            {
                return Err(invalid());
            }
            let mut store = StoreFile::default();
            store.codex_official_auth = legacy.codex_official_auth;
            store.official_auth_loaded = true;
            for (name, agent) in legacy.agents {
                let mut ids = BTreeSet::new();
                let mut providers = Vec::new();
                for p in agent.providers {
                    if p.id.is_empty() || !ids.insert(p.id.clone()) {
                        return Err(invalid());
                    }
                    providers.push(ProviderConfig {
                        id: p.id,
                        name: p.name,
                        base_url: p.base_url,
                        api_key: p.api_key,
                        model: p.model,
                        created_at: p.created_at,
                    });
                }
                store.agents.insert(
                    name,
                    AgentProviders {
                        providers,
                        current_id: agent.current_id,
                    },
                );
            }
            Ok(Parsed::Legacy(store))
        }
        Some(2) => {
            let metadata: Metadata = serde_json::from_slice(bytes).map_err(|_| invalid())?;
            metadata.validate()?;
            Ok(Parsed::Current(metadata))
        }
        _ => Err(invalid()),
    }
}

impl Metadata {
    pub(super) fn validate(&self) -> Result<(), AppError> {
        if self.version != VERSION || !valid_id(&self.vault) {
            return Err(invalid());
        }
        let mut references = BTreeSet::new();
        if let Some(r) = &self.codex_official_auth_ref {
            if !valid_id(r) || !references.insert(r) {
                return Err(invalid());
            }
        }
        for agent in self.agents.values() {
            let mut ids = BTreeSet::new();
            for p in &agent.providers {
                if p.id.is_empty() || !ids.insert(&p.id) {
                    return Err(invalid());
                }
                if let Some(r) = &p.api_key_ref {
                    if !valid_id(r) || !references.insert(r) {
                        return Err(invalid());
                    }
                }
            }
        }
        Ok(())
    }

    pub(super) fn into_runtime(self) -> StoreFile {
        let mut refs = References {
            vault: Some(self.vault),
            official: self.codex_official_auth_ref,
            ..References::default()
        };
        let agents = self
            .agents
            .into_iter()
            .map(|(name, agent)| {
                let providers = agent
                    .providers
                    .into_iter()
                    .map(|p| {
                        if let Some(r) = p.api_key_ref {
                            refs.api_keys.insert((name.clone(), p.id.clone()), r);
                        }
                        ProviderConfig {
                            id: p.id,
                            name: p.name,
                            base_url: p.base_url,
                            api_key: String::new(),
                            model: p.model,
                            created_at: p.created_at,
                        }
                    })
                    .collect();
                (
                    name,
                    AgentProviders {
                        providers,
                        current_id: agent.current_id,
                    },
                )
            })
            .collect();
        StoreFile {
            agents,
            refs: std::cell::RefCell::new(refs),
            ..StoreFile::default()
        }
    }
}
