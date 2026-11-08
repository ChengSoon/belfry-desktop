//! Select translated Rust format strings at compile time. Values are formatted only once and
//! are never parsed back out of the rendered text, so quotes/newlines in user input remain data.
use proc_macro::TokenStream;
use quote::quote;
use std::collections::{BTreeMap, VecDeque};
use syn::{parse::{Parse, ParseStream}, LitStr};

struct Input { source: LitStr, args: proc_macro2::TokenStream }
impl Parse for Input {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        Ok(Self { source: input.parse()?, args: input.parse()? })
    }
}

#[derive(Debug)]
enum Part { Text(String), Field { name: String, original: String } }
fn parts(template: &str) -> Vec<Part> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut rest = template;
    let mut implicit = 0;
    while !rest.is_empty() {
        if rest.starts_with("{{") || rest.starts_with("}}") {
            text.push_str(&rest[..2]); rest = &rest[2..]; continue;
        }
        if let Some(after) = rest.strip_prefix('{') && let Some(end) = after.find('}') {
            let field = &after[..end];
            let (name, spec) = field.split_once(':').map_or((field, None), |(name, spec)| (name, Some(spec)));
            if name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
                let position = if name.is_empty() { let at = implicit; implicit += 1; Some(at.to_string()) }
                    else if name.bytes().all(|ch| ch.is_ascii_digit()) { Some(name.to_string()) } else { None };
                let original_name = position.as_deref().unwrap_or(name);
                let original = spec.map_or_else(|| original_name.to_string(), |spec| format!("{original_name}:{spec}"));
                let name = position.map_or_else(|| name.to_string(), |position| format!("p{position}"));
                out.push(Part::Text(std::mem::take(&mut text)));
                out.push(Part::Field { name, original });
                rest = &after[end + 1..]; continue;
            }
        }
        let ch = rest.chars().next().unwrap(); text.push(ch); rest = &rest[ch.len_utf8()..];
    }
    out.push(Part::Text(text)); out
}

fn translated(source: &str) -> Result<String, String> {
    let source_parts = parts(source);
    let entries: serde_json::Value = serde_json::from_str(include_str!("../../belfry-i18n/catalog.json")).expect("valid catalog");
    for entry in entries.as_array().unwrap() {
        let zh = parts(entry["zh"].as_str().unwrap());
        if zh.len() != source_parts.len() { continue; }
        if !zh.iter().zip(&source_parts).all(|(a,b)| match (a,b) {
            (Part::Text(a), Part::Text(b)) => a == b,
            (Part::Field { .. }, Part::Field { .. }) => true,
            _ => false,
        }) { continue; }
        let mut fields: BTreeMap<String, VecDeque<String>> = BTreeMap::new();
        for (catalog, source) in zh.iter().zip(&source_parts) {
            if let (Part::Field { name, .. }, Part::Field { original, .. }) = (catalog, source) {
                fields.entry(name.clone()).or_default().push_back(original.clone());
            }
        }
        let mut output = String::new();
        for part in parts(entry["en"].as_str().unwrap()) {
            match part {
                Part::Text(text) => output.push_str(&text),
                Part::Field { name, .. } => {
                    let values = fields.get_mut(&name).ok_or_else(|| format!("unknown translated parameter {name}"))?;
                    let value = if values.len() > 1 { values.pop_front().unwrap() } else { values.front().ok_or("missing translated parameter")?.clone() };
                    output.push('{'); output.push_str(&value); output.push('}');
                }
            }
        }
        return Ok(output);
    }
    Err(format!("No translation for format template: {source}"))
}

#[proc_macro]
pub fn lformat(input: TokenStream) -> TokenStream {
    let Input { source, args } = syn::parse_macro_input!(input as Input);
    match translated(&source.value()) {
        Ok(english) => {
            let english = LitStr::new(&english, source.span());
            quote!({
                if ::belfry_i18n::current() == ::belfry_i18n::Locale::En {
                    ::std::format!(#english #args)
                } else {
                    ::std::format!(#source #args)
                }
            }).into()
        }
        Err(error) => syn::Error::new(source.span(), error).to_compile_error().into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn translations_reorder_fields_without_inspecting_values() {
        assert_eq!(translated("[belfry] 来自「{from_label}」的任务 {}\n{}\n完成后执行：belfry done {}").unwrap(),
            "[belfry] Task {0} from \"{from_label}\"\n{1}\nWhen finished, run: belfry done {2}");
        assert_eq!(translated("角色名最多 {MAX_TITLE_CHARS} 个字").unwrap(), "Role names may contain at most {MAX_TITLE_CHARS} characters.");
    }
}
