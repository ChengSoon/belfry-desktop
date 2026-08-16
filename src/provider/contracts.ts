import type { AgentKind } from "../workspace/contracts";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  /** 空串表示不覆盖模型，沿用 CLI 自己的默认。 */
  model: string;
  createdAt: number;
}

export interface AgentProviderGroup {
  kind: AgentKind;
  providers: ProviderConfig[];
  /** null = 官方端点。官方不占列表里的位置，它是「把写进去的字段撤掉」。 */
  currentId: string | null;
}

/** 冲突变量的来源。shell 的能改 rc 文件，process 的多半来自 launchd/GUI 环境。 */
export type EnvConflictSource = "process" | "shell";

export interface EnvConflict {
  kind: AgentKind;
  name: string;
  source: EnvConflictSource;
}

export interface ProviderCatalog {
  agents: AgentProviderGroup[];
  envConflicts: EnvConflict[];
}

export interface ProviderDraft {
  /** null 表示新增。 */
  id: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface SwitchOutcome {
  catalog: ProviderCatalog;
  /** Claude Code 每次请求前重读配置；Codex 只在启动时读一次。 */
  effectiveImmediately: boolean;
}

export const EMPTY_DRAFT: ProviderDraft = {
  id: null,
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
};

export const AGENT_LABEL: Record<AgentKind, string> = {
  codex: "Codex",
  claude: "Claude Code",
};

export function toDraft(config: ProviderConfig): ProviderDraft {
  return {
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  };
}

/** 一个配置文件预览；可为磁盘原文，也可为草稿套用后的内存内容。 */
export interface ConfigFilePreview {
  path: string;
  /** "json" | "toml"，前端按这个贴标签。 */
  format: "json" | "toml";
  /** 配置文本；文件不存在时为空串。 */
  content: string;
}
