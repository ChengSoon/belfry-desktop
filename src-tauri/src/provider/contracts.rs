use serde::{Deserialize, Serialize};

use crate::agent::AgentKind;

/// 一条 provider 配置。
///
/// 字段刻意只有路由三要素加一个显示名：Belfry 精准改写 CLI 的配置文件，
/// 认领的字段越少，用户手写的那些（hooks、MCP、模型映射）越安全。
// Runtime-only: secrets must not acquire an accidental IPC/disk serialization path.
#[derive(Clone, PartialEq)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    /// 空串表示不覆盖模型，沿用 CLI 自己的默认。
    pub model: String,
    pub created_at: u64,
}

/// API 响应只带凭据存在标志；不能把运行时 ProviderConfig 直接返回给 UI。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub has_api_key: bool,
    pub model: String,
    pub created_at: u64,
}

impl ProviderSummary {
    pub fn from_config(config: &ProviderConfig, has_api_key: bool) -> Self {
        Self {
            id: config.id.clone(),
            name: config.name.clone(),
            base_url: config.base_url.clone(),
            has_api_key,
            model: config.model.clone(),
            created_at: config.created_at,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ApiKeyAction {
    Keep,
    Replace,
    Clear,
}

/// 表单提交上来的内容。动作必须显式传入，旧客户端不能以空值覆盖秘密。
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderDraft {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub api_key_action: ApiKeyAction,
    #[serde(default)]
    pub model: String,
}

impl ProviderDraft {
    /// 表单校验。前端也会拦一道，这里是后端的最后一关。
    pub fn validate(&self) -> Result<(), crate::terminal::AppError> {
        use crate::terminal::AppError;
        self.validate_key_action()?;
        if self.name.trim().is_empty() {
            return Err(AppError::invalid_argument("provider 名称不能为空"));
        }
        let url = self.base_url.trim();
        if url.is_empty() {
            return Err(AppError::invalid_argument("Base URL 不能为空"));
        }
        // 只认 scheme，不强求 `//`：真实配置里存在 `https:\host` 这种单反斜杠写法，
        // WHATWG 规范里 special scheme 后的 `\` 等价于 `/`，CLI 那边照样跑得通。
        // 卡死它等于让接管进来的条目一编辑就存不回去。
        let lower = url.to_ascii_lowercase();
        if !lower.starts_with("http:") && !lower.starts_with("https:") {
            return Err(AppError::invalid_argument(
                "Base URL 必须以 http:// 或 https:// 开头",
            ));
        }
        Ok(())
    }

    pub fn validate_key_action(&self) -> Result<(), crate::terminal::AppError> {
        use crate::terminal::AppError;
        match self.api_key_action {
            ApiKeyAction::Keep if self.id.is_none() => Err(AppError::invalid_argument(
                "新增 Provider 不能保留不存在的密钥",
            )),
            ApiKeyAction::Replace if self.api_key.trim().is_empty() => Err(
                AppError::invalid_argument("替换密钥不能为空；如需删除请选择清除"),
            ),
            ApiKeyAction::Keep | ApiKeyAction::Clear if !self.api_key.is_empty() => {
                Err(AppError::invalid_argument("只有替换操作可以提交密钥"))
            }
            _ => Ok(()),
        }
    }
}

/// 一个 agent 的全部 provider 与当前选择。
#[derive(Clone, Debug, Default)]
pub struct AgentProviders {
    pub providers: Vec<ProviderConfig>,
    /// None = 官方。官方不占 `providers` 里的位置，它是「把 Belfry 写的东西删掉」。
    pub current_id: Option<String>,
}

impl AgentProviders {
    pub fn find(&self, id: &str) -> Option<&ProviderConfig> {
        self.providers.iter().find(|item| item.id == id)
    }
}

/// 目录里的一组。带 `kind` 而不是给每个 agent 开一个具名字段，
/// 这样接入新 agent 只要往 `PROVIDER_CAPABLE` 里加一项，契约不用动。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderGroup {
    pub kind: AgentKind,
    pub providers: Vec<ProviderSummary>,
    pub current_id: Option<String>,
}

/// 前端一次拿全的目录。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCatalog {
    pub agents: Vec<AgentProviderGroup>,
    /// shell 里已有的同名环境变量会盖过配置文件，切了看着像没生效。
    pub env_conflicts: Vec<EnvConflict>,
}

/// 一个会让配置文件失效的环境变量。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConflict {
    pub kind: AgentKind,
    pub name: String,
    pub source: EnvConflictSource,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvConflictSource {
    /// Belfry 进程自己继承到的。GUI 从 Finder 启动时通常拿不到 rc 文件里的东西。
    Process,
    /// 登录 shell 里读到的，也就是用户写在 `.zshrc` 之类文件里的。
    Shell,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchOutcome {
    pub catalog: ProviderCatalog,
    /// Claude Code 每次请求前重读 settings.json，切完就生效；
    /// Codex 只在启动时读一次 config.toml，已经开着的会话得重开。
    pub effective_immediately: bool,
}

/// 一个配置文件预览；可以是磁盘原文，也可以是草稿套用后的内存内容。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFilePreview {
    pub path: String,
    /// "json" | "toml"。前端按这个贴标签。
    pub format: String,
    /// 文件原始文本；文件不存在时为空串。
    pub content: String,
}

// 不输出配置文本、端点或草稿输入；解析错误同样不能回显含凭据的原文。
impl std::fmt::Debug for ProviderConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProviderConfig([redacted])")
    }
}
impl std::fmt::Debug for ProviderDraft {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProviderDraft([redacted])")
    }
}
impl std::fmt::Debug for ConfigFilePreview {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConfigFilePreview([redacted])")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(name: &str, base_url: &str) -> ProviderDraft {
        ProviderDraft {
            id: None,
            name: name.to_string(),
            base_url: base_url.to_string(),
            api_key: "sk-test".to_string(),
            api_key_action: ApiKeyAction::Replace,
            model: String::new(),
        }
    }

    #[test]
    fn rejects_a_blank_name_even_when_it_looks_present() {
        assert!(draft("   ", "https://example.com").validate().is_err());
    }

    #[test]
    fn rejects_a_base_url_without_a_scheme() {
        // 少了 scheme 的地址喂给 CLI 只会得到一个难懂的连接错误，在这里拦掉。
        assert!(draft("Kimi", "api.moonshot.cn").validate().is_err());
    }

    #[test]
    fn accepts_the_single_backslash_form_found_in_real_config_files() {
        // 真实的 settings.json 里就有 `https:\host` 这种写法，而且它在跑。
        // 前端用 URL 解析放行了它，后端这里得跟上，不然存不回去。
        assert!(
            draft("中转", "https:\\relay.example.org")
                .validate()
                .is_ok()
        );
    }

    #[test]
    fn accepts_a_well_formed_draft() {
        assert!(
            draft("Kimi", "https://api.moonshot.cn/anthropic")
                .validate()
                .is_ok()
        );
    }
}
