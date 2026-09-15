use super::{QuotaSnapshot, fingerprint, read_raw_cumulative, read_window};
use crate::usage::{contracts::TokenTotals, timestamp::parse_rfc3339};
use serde_json::Value;

/// 精简事件只保留统计字段，不复制提示词和工具输出。
#[derive(Clone, Debug)]
pub(crate) enum CodexRecord {
    Meta {
        id: Option<String>,
        cwd: Option<String>,
    },
    Context {
        model: Option<String>,
        cwd: Option<String>,
    },
    Usage {
        at: Option<i64>,
        tokens: Option<TokenTotals>,
        quota: Option<QuotaSnapshot>,
        fingerprint: u64,
    },
}

impl CodexRecord {
    pub fn parse(record: &Value) -> Option<Self> {
        let payload = &record["payload"];
        let cwd = || text(&payload["cwd"]).filter(|value| !value.is_empty());
        match record["type"].as_str() {
            Some("session_meta") => Some(Self::Meta {
                id: text(&payload["session_id"]).or_else(|| text(&payload["id"])),
                cwd: cwd(),
            }),
            Some("turn_context") => Some(Self::Context {
                model: text(&payload["model"]).filter(|value| !value.is_empty()),
                cwd: cwd(),
            }),
            _ if payload["type"] == "token_count" => {
                let at = record["timestamp"].as_str().and_then(parse_rfc3339);
                let usage = &payload["info"]["total_token_usage"];
                Some(Self::Usage {
                    at,
                    tokens: usage.is_object().then(|| read_raw_cumulative(usage)),
                    quota: quota(&payload["rate_limits"], at),
                    fingerprint: fingerprint(record),
                })
            }
            _ => None,
        }
    }

    pub fn heap_bytes(&self) -> usize {
        match self {
            Self::Meta { id, cwd } => capacity(id) + capacity(cwd),
            Self::Context { model, cwd } => capacity(model) + capacity(cwd),
            Self::Usage { quota, .. } => {
                quota.as_ref().map_or(0, |quota| capacity(&quota.plan_type))
            }
        }
    }
}

fn text(value: &Value) -> Option<String> {
    value.as_str().map(ToOwned::to_owned)
}

fn capacity(value: &Option<String>) -> usize {
    value.as_ref().map_or(0, String::capacity)
}

fn quota(limits: &Value, at: Option<i64>) -> Option<QuotaSnapshot> {
    let primary = read_window(&limits["primary"]);
    let secondary = read_window(&limits["secondary"]);
    (primary.is_some() || secondary.is_some()).then(|| QuotaSnapshot {
        plan_type: text(&limits["plan_type"]),
        primary,
        secondary,
        observed_at: at,
    })
}
