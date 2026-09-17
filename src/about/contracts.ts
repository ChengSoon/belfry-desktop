/** 后端 `agent_release_report` 的返回。字段名与 `AgentRelease` 的 camelCase 序列化一致。 */
export type ReleaseState = "ready" | "upgradable" | "missing" | "unmanaged" | "unknown";

export interface AgentRelease {
  kind: "codex" | "claude" | "pi";
  displayName: string;
  command: string;
  executable: string | null;
  currentVersion: string | null;
  latestVersion: string | null;
  /** 从可执行文件反查出的真实包名；未安装时是官方默认包名。 */
  package: string | null;
  state: ReleaseState;
  notice: string | null;
  installCommand: string | null;
}

export interface AgentReleaseInstall {
  kind: "codex" | "claude" | "pi";
  package: string;
  /** npm 自身非零退出算失败，log 里有原因。 */
  success: boolean;
  version: string | null;
  log: string;
}

export const RELEASE_LABEL: Record<ReleaseState, string> = {
  ready: "已是最新",
  upgradable: "有新版本",
  missing: "未安装",
  unmanaged: "非 npm 管理",
  unknown: "状态未知",
};

export const REPO_URL = "https://github.com/ChengSoon/belfry-desktop";
export const CHANGELOG_URL = "https://github.com/ChengSoon/belfry-desktop/releases";

/** 可一键升级的 CLI 数量，驱动「全部升级」按钮。 */
export function countUpgradable(releases: readonly AgentRelease[]): number {
  return releases.filter((release) => release.state === "upgradable").length;
}

/** 展示用平台名。不使用快捷键那套 platform：它返回的是修饰键归属，不是平台名。 */
export function platformLabel(): string {
  return document.documentElement.dataset.platform === "windows" ? "Windows" : "macOS";
}

export function openExternal(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}
