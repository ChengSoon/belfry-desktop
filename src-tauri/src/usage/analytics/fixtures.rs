use super::{
    cache::FileCache,
    contracts::AnalyticsReport,
    service::{self, ScanRequest},
    sources::SourceRoots,
};
use crate::usage::{
    contracts::{TokenTotals, UsageQuery},
    timestamp::parse_rfc3339,
};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub(super) const PROJECT: &str = "/__belfry_usage_fixture__/project";
pub(super) const TIME: &str = "2026-09-14T10:00:00Z";

pub(super) struct Fixture {
    pub path: PathBuf,
    pub roots: SourceRoots,
}

impl Fixture {
    pub fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("belfry-analytics-cache-{}", ulid::Ulid::generate()));
        let claude = path.join("claude");
        let codex = path.join("codex");
        fs::create_dir_all(&claude).unwrap();
        fs::create_dir_all(&codex).unwrap();
        Self {
            path,
            roots: SourceRoots {
                claude: Some(claude),
                codex: Some(codex),
            },
        }
    }

    pub fn write(&self, name: &str, records: &[Value]) -> PathBuf {
        self.write_text(name, &lines(records))
    }

    pub fn write_text(&self, name: &str, text: &str) -> PathBuf {
        let path = self.path.join(name);
        fs::write(&path, text).unwrap();
        path
    }

    pub fn query(&self, cache: &mut FileCache, query: &UsageQuery) -> AnalyticsReport {
        service::refresh(
            cache,
            ScanRequest {
                query,
                now: now(),
                roots: &self.roots,
                check: &|| Ok(()),
            },
        )
        .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub(super) fn now() -> i64 {
    parse_rfc3339("2026-09-14T12:00:00Z").unwrap()
}

pub(super) fn lines(records: &[Value]) -> String {
    records
        .iter()
        .map(|record| record.to_string() + "\n")
        .collect()
}

pub(super) fn append(path: &Path, text: &str) {
    OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(text.as_bytes())
        .unwrap();
}

pub(super) fn claude(id: &str, output: u64) -> Value {
    json!({"timestamp":TIME,"cwd":PROJECT,"requestId":id,"message":{"role":"assistant", "id":id,"model":"fixture-claude",
        "usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":30,"output_tokens":output}}})
}

pub(super) fn meta(id: &str) -> Value {
    json!({"type":"session_meta","payload":{"id":id,"cwd":PROJECT}})
}

pub(super) fn context(model: &str) -> Value {
    json!({"type":"turn_context","payload":{"model":model,"cwd":PROJECT}})
}

pub(super) fn snapshot(time: Option<&str>, tokens: TokenTotals) -> Value {
    json!({"timestamp":time,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{
        "input_tokens":tokens.input,"cached_input_tokens":tokens.cached_input,"cache_write_input_tokens":tokens.cache_write,"output_tokens":tokens.output}}}})
}

pub(super) fn cumulative(input: u64) -> TokenTotals {
    TokenTotals {
        input,
        cached_input: input / 5,
        cache_write: 0,
        output: input / 10,
    }
}

pub(super) fn semantic(report: &AnalyticsReport) -> Value {
    let mut value = serde_json::to_value(report).unwrap();
    value.as_object_mut().unwrap().remove("diagnostics");
    value
}

pub(super) fn total(report: &AnalyticsReport) -> u64 {
    report.rows.iter().map(|row| row.tokens.total()).sum()
}

pub(super) fn uncached() -> FileCache {
    let mut cache = FileCache::default();
    cache.budget = 0;
    cache
}

pub(super) fn assert_streamed_matches_legacy(
    fixture: &Fixture,
    cache: &mut FileCache,
    query: UsageQuery,
) {
    let expected = super::legacy::collect_at(&query, &fixture.roots, now()).unwrap();
    let actual = fixture.query(cache, &query);
    assert_eq!(semantic(&expected), semantic(&actual));
    assert_eq!(0, actual.diagnostics.cache_hits);
    assert_eq!(0, cache.len());
    assert!(actual.diagnostics.read_bytes > 0);
}
