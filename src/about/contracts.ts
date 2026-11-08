import { localized, t } from "../i18n";
import type { AgentKind } from "../agent/contracts";
/** 后端 `agent_release_report` 的返回。字段名与 `AgentRelease` 的 camelCase 序列化一致。 */
export type ReleaseState = "ready" | "upgradable" | "missing" | "unmanaged" | "unknown";

export interface AgentRelease {
  kind: AgentKind;
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
  kind: AgentKind;
  package: string;
  /** npm 自身非零退出算失败，log 里有原因。 */
  success: boolean;
  version: string | null;
  log: string;
}

export const RELEASE_LABEL: Record<ReleaseState, string> = localized(() => ({
  ready: t("about.contracts.text_4219a7449e"),
  upgradable: t("about.contracts.text_daedea3858"),
  missing: t("about.contracts.text_156219e305"),
  unmanaged: t("about.contracts.text_e9d5f09a6a"),
  unknown: t("about.contracts.text_93e474c68e"),
}));

export const REPO_URL = "https://github.com/ChengSoon/belfry-desktop";
export const CHANGELOG_URL = "https://github.com/ChengSoon/belfry-desktop/releases";
export const DOCS_URL = "https://chengsoon.github.io/belfry-desktop/";

/** 可一键升级的 CLI 数量，驱动「全部升级」按钮。 */
export function countUpgradable(releases: readonly AgentRelease[]): number {
  return releases.filter((release) => release.state === "upgradable").length;
}

/** 展示用平台名。不使用快捷键那套 platform：它返回的是修饰键归属，不是平台名。 */
export function platformLabel(): string {
  return document.documentElement.dataset.platform === "windows" ? "Windows" : "macOS";
}

export { openExternal } from "../utils/openExternal";
