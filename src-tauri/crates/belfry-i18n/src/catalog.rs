use crate::{current, Locale};
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use std::{collections::{BTreeMap, HashMap}, sync::OnceLock};

#[derive(Deserialize)]
struct Entry { code: String, zh: String, en: String }
struct Pattern { index: usize, source: String, prefix: String, suffix: String, specificity: usize, regex: OnceLock<Regex>, names: Vec<String> }
struct Catalog { entries: Vec<Entry>, exact: HashMap<String, usize>, patterns: Vec<Pattern> }

pub struct ErrorText { pub code: String, pub message: String, pub params: BTreeMap<String, Value> }

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let entries: Vec<Entry> = serde_json::from_str(include_str!("../catalog.json")).expect("valid embedded text catalog");
        let mut exact = HashMap::new();
        let mut patterns = Vec::new();
        for (index, entry) in entries.iter().enumerate() {
            for template in [&entry.zh, &entry.en] {
                let (regex, names) = pattern(template);
                if names.is_empty() { exact.insert(unescape_braces(template), index); }
                else {
                    let parts = segments(template);
                    let prefix = match parts.first() { Some(Segment::Text(text)) => text.clone(), _ => String::new() };
                    let suffix = match parts.last() { Some(Segment::Text(text)) => text.clone(), _ => String::new() };
                    let specificity = parts.iter().map(|part| match part { Segment::Text(text) => text.len(), _ => 0 }).sum();
                    patterns.push(Pattern { index, source: regex, prefix, suffix, specificity, regex: OnceLock::new(), names });
                }
            }
        }
        // Specific messages must win over short wrappers such as "Read failed: {error}".
        patterns.sort_by_key(|pattern| std::cmp::Reverse(pattern.specificity));
        Catalog { entries, exact, patterns }
    })
}

pub fn text(value: &str) -> &str {
    let catalog = catalog();
    let Some(index) = catalog.exact.get(value) else { return value; };
    let entry = &catalog.entries[*index];
    if current() == Locale::ZhCn { &entry.zh } else { &entry.en }
}

pub fn localize(value: &str) -> String {
    let Some((entry, params)) = find(value) else { return value.into(); };
    render(if current() == Locale::ZhCn { &entry.zh } else { &entry.en }, &params)
}

/// Compatibility boundary for legacy Rust helpers returning formatted String errors.
/// The committed catalog supplies stable codes and named parameters; raw prose is never a key on the wire.
pub fn error_text(value: &str) -> Option<ErrorText> {
    // Plugin API errors may carry a stable category prefix before their explanation.
    let (entry, params) = find(value).or_else(|| {
        let (code, message) = value.split_once(": ")?;
        if code.is_empty() || !code.bytes().all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == b'_') { return None; }
        find(message)
    })?;
    Some(ErrorText { code: entry.code.clone(), message: render(&entry.en, &params), params })
}

/// Render the English fallback again after the application has redacted parameter values.
pub fn error_message(code: &str, params: &BTreeMap<String, Value>) -> Option<String> {
    let entry = catalog().entries.iter().find(|entry| entry.code == code)?;
    Some(render(&entry.en, params))
}

fn find(value: &str) -> Option<(&'static Entry, BTreeMap<String, Value>)> {
    let catalog = catalog();
    if let Some(index) = catalog.exact.get(value) { return Some((&catalog.entries[*index], BTreeMap::new())); }
    for pattern in &catalog.patterns {
        // A short CLI invocation should not compile the entire application catalog. Prefix/suffix
        // rejection is cheap, and only templates that may actually match acquire a compiled regex.
        if !value.starts_with(&pattern.prefix) || !value.ends_with(&pattern.suffix) { continue; }
        let regex = pattern.regex.get_or_init(|| Regex::new(&pattern.source).expect("valid text template"));
        let Some(captures) = regex.captures(value) else { continue; };
        let mut params = BTreeMap::new();
        let mut consistent = true;
        for (index, name) in pattern.names.iter().enumerate() {
            let captured = captures.get(index + 1)?.as_str();
            let parsed = if captured == "0" || !captured.starts_with('0') { captured.parse::<i64>().ok() } else { None };
            let value = parsed.map_or_else(|| Value::String(captured.into()), |value| Value::Number(value.into()));
            if params.get(name).is_some_and(|previous| previous != &value) { consistent = false; break; }
            params.insert(name.clone(), value);
        }
        if consistent { return Some((&catalog.entries[pattern.index], params)); }
    }
    None
}

enum Segment { Text(String), Slot(String) }
fn segments(template: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut literal = String::new();
    let mut rest = template;
    let mut position = 0;
    while !rest.is_empty() {
        if rest.starts_with("{{") || rest.starts_with("}}") {
            literal.push(rest.chars().next().unwrap()); rest = &rest[2..]; continue;
        }
        if let Some(after) = rest.strip_prefix('{') && let Some(end) = after.find('}') {
            let field = after[..end].split(':').next().unwrap();
            if field.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
                let name = if field.is_empty() { let name = format!("p{position}"); position += 1; name }
                    else if field.bytes().all(|ch| ch.is_ascii_digit()) { format!("p{field}") } else { field.into() };
                segments.push(Segment::Text(std::mem::take(&mut literal)));
                segments.push(Segment::Slot(name)); rest = &after[end + 1..]; continue;
            }
        }
        let ch = rest.chars().next().unwrap(); literal.push(ch); rest = &rest[ch.len_utf8()..];
    }
    segments.push(Segment::Text(literal)); segments
}
fn pattern(template: &str) -> (String, Vec<String>) {
    let mut pattern = "(?s)^".to_string();
    let mut names = Vec::new();
    for segment in segments(template) {
        match segment { Segment::Text(text) => pattern.push_str(&regex::escape(&text)), Segment::Slot(name) => { names.push(name); pattern.push_str("(.*?)"); } }
    }
    pattern.push('$'); (pattern, names)
}
fn render(template: &str, params: &BTreeMap<String, Value>) -> String {
    segments(template).into_iter().map(|segment| match segment {
        Segment::Text(text) => text,
        Segment::Slot(name) => params.get(&name).map(|value| value.as_str().map(str::to_owned).unwrap_or_else(|| value.to_string())).unwrap_or_default(),
    }).collect()
}
fn unescape_braces(template: &str) -> String { template.replace("{{", "{").replace("}}", "}") }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_codes_and_parameters_are_stable_and_complete() {
        let mut codes = std::collections::HashSet::new();
        for entry in &catalog().entries {
            assert!(codes.insert(&entry.code), "duplicate code {}", entry.code);
            assert!(entry.code.bytes().all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit() || ch == b'_'));
            assert!(!entry.en.is_empty(), "{}", entry.code);
            let names = |template: &str| pattern(template).1.into_iter().collect::<std::collections::BTreeSet<_>>();
            assert_eq!(names(&entry.zh), names(&entry.en), "{}", entry.code);
        }
    }
    #[test]
    fn both_languages_identify_the_same_code_and_named_parameters() {
        for entry in &catalog().entries {
            let params = pattern(&entry.zh).1.into_iter().map(|name| {
                let value = Value::String(format!("sample_{name}"));
                (name, value)
            }).collect::<BTreeMap<_, _>>();
            for template in [&entry.zh, &entry.en] {
                let rendered = render(template, &params);
                let found = error_text(&rendered).unwrap_or_else(|| panic!("No match for {}", entry.code));
                assert_eq!(found.code, entry.code, "{rendered}");
                assert_eq!(found.params, params, "{}", entry.code);
            }
        }
    }
    #[test]
    fn formatted_errors_keep_parameters_out_of_the_stable_code() {
        let error = error_text("角色名最多 40 个字").unwrap();
        assert_eq!(error.code, "ROOM_ROLE_NAME_LIMIT");
        assert_eq!(error.params["max"], 40);
        assert_eq!(error.message, "Role names may contain at most 40 characters.");
    }
    #[test]
    fn locale_switches_only_templates_and_preserves_user_text() {
        crate::with_locale(Locale::En, || {
            assert_eq!(text("选择文件"), "Choose a file");
            assert_eq!(localize("找不到 provider：用户的服务"), "Provider not found: 用户的服务");
        });
    }
}
