//! 共享上下文的落盘：`<project>/.belfry/context/`。
//!
//! 存在项目里而不是应用数据目录，是因为这份东西的读者不只是 UI，更是 Agent 自己。
//! Agent 拿得到的是项目内的相对路径，它会 `cat`、会 grep；应用数据目录对它来说
//! 是个够不着的地方。代价是要提醒用户把 `.belfry/` 加进 `.gitignore`。
//!
//! 布局：
//! - `index.json` 全部条目的元数据，前端只读这一份
//! - `<id>.md`    超过内联阈值的正文，Agent 直接读这个文件
//!
//! 路径安全沿用 `project::files` 那套：一切解析结果都必须落在项目根以内。
//! 这里比预览更需要小心——预览只读，这里要写。

use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::atomic::{read_text_optional, write_atomic};
use crate::resource::canonicalize;
use crate::terminal::AppError;

use super::contracts::{ContextItem, ContextWrite};

const CONTEXT_DIR: &str = ".belfry/context";
const INDEX_FILE: &str = "index.json";
/// 和前端 `CONTEXT_INLINE_MAX` 对齐：短内容进 index.json，长内容落单独文件。
const INLINE_MAX: usize = 1_200;
/// 单条正文硬上限，挡住把整个日志塞进来。
const BODY_MAX: usize = 256 * 1024;
const ITEMS_MAX: usize = 200;

pub fn list(root_path: &str) -> Result<Vec<ContextItem>, AppError> {
    let root = project_root(root_path)?;
    read_index(&root)
}

pub fn put(root_path: &str, write: ContextWrite) -> Result<ContextItem, AppError> {
    if write.body.len() > BODY_MAX {
        return Err(AppError::invalid_argument(
            "共享上下文单条正文超过上限",
        ));
    }
    let id = validate_id(&write.id)?;
    let root = project_root(root_path)?;
    let dir = context_dir(&root);

    // 短内容留在索引里省一次读文件；长的落盘，索引只记路径。
    let inline = write.body.chars().count() <= INLINE_MAX;
    let (body, relative) = if inline {
        (Some(write.body.clone()), None)
    } else {
        let file = dir.join(format!("{id}.md"));
        guard_inside(&root, &file)?;
        write_atomic(&file, &write.body, false)?;
        (None, Some(format!("{CONTEXT_DIR}/{id}.md")))
    };

    let mut items = read_index(&root)?;
    let now = write.updated_at;
    let item = ContextItem {
        id: id.clone(),
        kind: write.kind,
        title: write.title,
        body,
        path: relative,
        source: write.source,
        tags: write.tags,
        pinned: write.pinned,
        created_at: items
            .iter()
            .find(|entry| entry.id == id)
            .map_or(write.created_at, |entry| entry.created_at),
        updated_at: now,
    };

    // 同 id 覆盖，新条目放最前——列表按加入顺序倒序读最顺手。
    items.retain(|entry| entry.id != id);
    items.insert(0, item.clone());
    items.truncate(ITEMS_MAX);
    write_index(&root, &items)?;
    Ok(item)
}

/// 取正文。内联的直接从索引给，落盘的读文件。
pub fn get(root_path: &str, id: &str) -> Result<String, AppError> {
    let id = validate_id(id)?;
    let root = project_root(root_path)?;
    let item = read_index(&root)?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| AppError::not_found(format!("共享上下文里没有 {id}")))?;

    if let Some(body) = item.body {
        return Ok(body);
    }
    let Some(relative) = item.path else {
        return Ok(String::new());
    };
    let file = resolve_inside(&root, &relative)?;
    read_text_optional(&file)
}

pub fn remove(root_path: &str, id: &str) -> Result<(), AppError> {
    let id = validate_id(id)?;
    let root = project_root(root_path)?;
    let mut items = read_index(&root)?;
    let Some(index) = items.iter().position(|entry| entry.id == id) else {
        return Ok(());
    };
    let removed = items.remove(index);
    write_index(&root, &items)?;

    // 正文文件删失败不该让整个删除失败：索引里已经没它了，留个孤儿文件是可接受的。
    if let Some(relative) = removed.path
        && let Ok(file) = resolve_inside(&root, &relative)
    {
        let _ = fs::remove_file(file);
    }
    Ok(())
}

/// 只翻元数据，不碰正文。
///
/// 单独开一条路是因为 `put` 是整条覆盖：落盘的条目正文在文件里，为了改一个
/// 布尔值把几百 KB 读进内存再写回索引，既浪费又会把正文复制到不该去的地方。
pub fn set_pinned(root_path: &str, id: &str, pinned: bool) -> Result<ContextItem, AppError> {
    let id = validate_id(id)?;
    let root = project_root(root_path)?;
    let mut items = read_index(&root)?;
    let item = items
        .iter_mut()
        .find(|entry| entry.id == id)
        .ok_or_else(|| AppError::not_found(format!("共享上下文里没有 {id}")))?;
    item.pinned = pinned;
    let updated = item.clone();
    write_index(&root, &items)?;
    Ok(updated)
}

fn read_index(root: &Path) -> Result<Vec<ContextItem>, AppError> {
    let path = context_dir(root).join(INDEX_FILE);
    let text = read_text_optional(&path)?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    // 逐条解析：这份文件 Agent 也能写，坏掉一条不该废掉整份索引。
    let raw: serde_json::Value = serde_json::from_str(&text)
        .map_err(|err| AppError::invalid_argument(format!("{} 不是合法 JSON：{err}", path.display())))?;
    let Some(entries) = raw.as_array() else {
        return Ok(Vec::new());
    };
    Ok(entries
        .iter()
        .filter_map(|entry| serde_json::from_value::<ContextItem>(entry.clone()).ok())
        .take(ITEMS_MAX)
        .collect())
}

fn write_index(root: &Path, items: &[ContextItem]) -> Result<(), AppError> {
    let path = context_dir(root).join(INDEX_FILE);
    guard_inside(root, &path)?;
    let text = serde_json::to_string_pretty(items)
        .map_err(|err| AppError::io(format!("序列化共享上下文索引失败：{err}")))?;
    write_atomic(&path, &text, false)
}

fn context_dir(root: &Path) -> PathBuf {
    root.join(".belfry").join("context")
}

fn project_root(root_path: &str) -> Result<PathBuf, AppError> {
    let requested = Path::new(root_path);
    let root = canonicalize(requested)
        .map_err(|err| AppError::io(format!("打不开项目根 {}：{err}", requested.display())))?;
    if !root.is_dir() {
        return Err(AppError::invalid_argument("项目根必须是一个目录"));
    }
    Ok(root)
}

/// 已存在的文件：canonicalize 之后再判边界，能挡住软链接指到项目外。
fn resolve_inside(root: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let relative = validate_relative(relative)?;
    let requested = root.join(relative);
    let resolved = canonicalize(&requested)
        .map_err(|err| AppError::io(format!("打不开 {}：{err}", requested.display())))?;
    if !resolved.starts_with(root) {
        return Err(AppError::invalid_argument("共享上下文必须留在项目根以内"));
    }
    Ok(resolved)
}

/// 还不存在的文件：canonicalize 会失败，所以只能校验路径成分本身。
fn guard_inside(root: &Path, path: &Path) -> Result<(), AppError> {
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
        || !path.starts_with(root)
    {
        return Err(AppError::invalid_argument("共享上下文必须留在项目根以内"));
    }
    Ok(())
}

fn validate_relative(value: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(value.trim());
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(AppError::invalid_argument("共享上下文路径必须是相对路径"));
    }
    Ok(path.to_path_buf())
}

/// id 会直接拼成文件名，所以必须挡住路径分隔符和 `..`。
fn validate_id(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 128
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed
            .chars()
            .any(|ch| ch.is_control() || ch == ':' || ch == '*' || ch == '?')
    {
        return Err(AppError::invalid_argument("共享上下文 id 不合法"));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
#[path = "store_test.rs"]
mod tests;
