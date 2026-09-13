use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use crate::terminal::AppError;
use super::contracts::{AliasReport, SshAlias};

const MAX_FILES: usize = 32;
const MAX_DEPTH: usize = 4;
const MAX_BYTES: u64 = 256 * 1024;
const MAX_ALIASES: usize = 200;
const MAX_WARNINGS: usize = 20;
const MAX_INCLUDE_MATCHES: usize = 512;

pub(super) fn read_default() -> Result<AliasReport, AppError> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from).ok_or_else(|| AppError::not_found("无法定位用户 SSH 配置目录"))?;
    read(&home.join(".ssh"))
}

pub(super) fn read(root: &Path) -> Result<AliasReport, AppError> {
    let mut reader = ConfigReader { root, files: HashSet::new(), names: HashSet::new(), report: AliasReport::default() };
    reader.visit(&root.join("config"), 0);
    reader.report.aliases.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(reader.report)
}

struct ConfigReader<'a> {
    root: &'a Path,
    files: HashSet<PathBuf>,
    names: HashSet<String>,
    report: AliasReport,
}

impl ConfigReader<'_> {
    fn visit(&mut self, path: &Path, depth: usize) {
        if depth > MAX_DEPTH || self.files.len() >= MAX_FILES { self.warn("部分 Include 超出读取上限，可直接输入别名连接"); return; }
        let path = match fs::canonicalize(path) { Ok(path) => path, Err(_) => { self.warn(&format!("未读取 {}", path.display())); return; } };
        if !self.files.insert(path.clone()) { return; }
        match read_file(&path) {
            Ok(content) => self.lines(&path, &content, depth),
            Err(error) => self.warn(&error.message),
        }
    }

    fn lines(&mut self, path: &Path, content: &str, depth: usize) {
        for line in content.lines() {
            let fields = words(line);
            let Some(key) = fields.first() else { continue; };
            if key.eq_ignore_ascii_case("host") { self.add_aliases(path, &fields[1..]); }
            if key.eq_ignore_ascii_case("include") {
                self.includes(&fields[1..], depth);
            }
        }
    }

    fn add_aliases(&mut self, path: &Path, names: &[String]) {
        for name in names.iter().filter(|name| explicit_alias(name)) {
            if self.report.aliases.len() >= MAX_ALIASES { self.warn("别名超过 200 项，仅显示前 200 项"); return; }
            if self.names.insert(name.to_ascii_lowercase()) {
                self.report.aliases.push(SshAlias { name: name.clone(), source: path.to_string_lossy().into_owned() });
            }
        }
    }

    fn includes(&mut self, values: &[String], depth: usize) {
        for value in values {
            let path = if let Some(tail) = value.strip_prefix("~/") {
                self.root.parent().unwrap_or(self.root).join(tail)
            } else { self.root.join(value) };
            match expand(&path) {
                Some(paths) => { for path in paths { self.visit(&path, depth + 1); } }
                None => self.warn("含动态目录或复杂模式的 Include 未导入，可手动输入其别名"),
            }
        }
    }

    fn warn(&mut self, message: &str) {
        if self.report.warnings.len() < MAX_WARNINGS && !self.report.warnings.iter().any(|value| value == message) {
            self.report.warnings.push(message.into());
        }
    }
}

fn read_file(path: &Path) -> Result<String, AppError> {
    if !fs::metadata(path).is_ok_and(|meta| meta.is_file()) {
        return Err(AppError::io("SSH 配置不是可读取的普通文件"));
    }
    let file = fs::File::open(path).map_err(|error| AppError::io(format!("SSH 配置无法读取：{error}")))?;
    if !file.metadata().map_err(|error| AppError::io(error.to_string()))?.is_file() {
        return Err(AppError::io("SSH 配置不是普通文件"));
    }
    let mut bytes = Vec::new(); file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|error| AppError::io(error.to_string()))?;
    if bytes.len() as u64 > MAX_BYTES { return Err(AppError::io("SSH 配置超过读取上限")); }
    String::from_utf8(bytes).map_err(|_| AppError::io("SSH 配置不是 UTF-8"))
}

fn explicit_alias(name: &str) -> bool {
    !name.is_empty() && name.len() <= 255 && !name.starts_with('-')
        && !name.contains(['*', '?', '!', '[', ']', '/', '\\'])
        && !name.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn expand(path: &Path) -> Option<Vec<PathBuf>> {
    let text = path.to_str()?;
    if text.contains(['%', '[', ']', '$']) { return None; }
    let parent = path.parent()?;
    if parent.to_string_lossy().contains(['*', '?']) { return None; }
    let name = path.file_name()?.to_str()?;
    if !name.contains(['*', '?']) { return Some(vec![path.into()]); }
    let mut paths = fs::read_dir(parent).ok()?.take(MAX_INCLUDE_MATCHES)
        .filter_map(Result::ok).filter(|entry| wildcard(name, &entry.file_name().to_string_lossy()))
        .map(|entry| entry.path()).collect::<Vec<_>>();
    paths.sort(); Some(paths)
}

fn wildcard(pattern: &str, value: &str) -> bool {
    let values = value.chars().collect::<Vec<_>>();
    let mut previous = vec![false; values.len() + 1]; previous[0] = true;
    for ch in pattern.chars() {
        let mut next = vec![false; previous.len()]; next[0] = ch == '*' && previous[0];
        for (index, value) in values.iter().enumerate() {
            next[index + 1] = if ch == '*' { previous[index + 1] || next[index] }
                else { (ch == '?' || ch == *value) && previous[index] };
        }
        previous = next;
    }
    previous[values.len()]
}

fn words(line: &str) -> Vec<String> {
    let mut result = Vec::new(); let mut token = String::new(); let mut quote = None; let mut escaped = false;
    for ch in line.chars() {
        if escaped { token.push(ch); escaped = false; continue; }
        if ch == '\\' { escaped = true; continue; }
        if Some(ch) == quote { quote = None; continue; }
        if quote.is_none() && (ch == '\'' || ch == '"') { quote = Some(ch); continue; }
        if quote.is_none() && ch == '#' { break; }
        if quote.is_none() && (ch.is_whitespace() || ch == '=') {
            if !token.is_empty() { result.push(std::mem::take(&mut token)); }
        } else { token.push(ch); }
    }
    if !token.is_empty() { result.push(token); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_explicit_aliases_and_bounded_includes_without_executing_match() {
        let root = std::env::temp_dir().join(format!("belfry-ssh-config-{}", ulid::Ulid::generate()));
        fs::create_dir_all(root.join("conf.d")).unwrap();
        fs::write(root.join("config"), "Host prod staging *.example !skip\n ProxyJump bastion\nInclude conf.d/*.conf\nMatch exec 'touch should-not-run'\nHost '中文' prod\n").unwrap();
        fs::write(root.join("conf.d/dev.conf"), "Host = dev # comment\nIdentityFile private-key\nInclude config\n").unwrap();
        let report = read(&root).unwrap();
        assert_eq!(vec!["dev", "prod", "staging", "中文"], report.aliases.iter().map(|alias| alias.name.as_str()).collect::<Vec<_>>());
        assert!(!root.join("should-not-run").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
