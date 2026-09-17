import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  HelpCircle,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useEffect } from "react";
import { ClaudeIcon, CodexIcon, PiIcon } from "../workspace/components/AgentIcons";
import { SettingsHeader } from "../settings/SettingsHeader";
import { ICON } from "../theme/sizing";
import type { UpdaterState } from "../updater/contracts";
import { failureLabel } from "../workspace/errors";
import appIconUrl from "../../src-tauri/icons/128x128.png";
import {
  CHANGELOG_URL,
  countUpgradable,
  openExternal,
  platformLabel,
  RELEASE_LABEL,
  REPO_URL,
  type AgentRelease,
  type ReleaseState,
} from "./contracts";
import { useAgentReleases } from "./useAgentReleases";
import "./about.css";

interface AboutSectionProps {
  updaterState: UpdaterState;
  updaterOpen: boolean;
  onOpenUpdater: () => void;
  onGuardChange: (guarded: boolean) => void;
}

const AGENT_ICON = { claude: ClaudeIcon, codex: CodexIcon, pi: PiIcon } as const;

export function AboutSection({ updaterState, updaterOpen, onOpenUpdater, onGuardChange }: AboutSectionProps) {
  const model = useAgentReleases(true);
  // 更新对话框叠在设置页之上时，Escape 只关对话框，别把设置页也一起关了。
  useEffect(() => {
    onGuardChange(updaterOpen);
    return () => onGuardChange(false);
  }, [updaterOpen, onGuardChange]);

  const upgradable = model.releases ? countUpgradable(model.releases) : 0;
  const busy = model.installing !== null;

  return (
    <section className="about-section" aria-label="关于">
      <SettingsHeader
        title="关于"
        description="查看版本信息与更新状态。"
        actions={
          <button className="provider-add" disabled={busy} onClick={onOpenUpdater} type="button">
            检查更新
          </button>
        }
      />

      <div className="provider-official about-app">
        <img alt="" className="about-app__icon" src={appIconUrl} />
        <div className="about-app__copy">
          <strong>Belfry</strong>
          <p>托管你的 CLI Agent，也是一把称手的终端。</p>
          <span className={`about-app__version about-app__version--${updaterState.status}`}>
            {updaterState.availableVersion ? `v${updaterState.currentVersion} → v${updaterState.availableVersion}` : `版本 v${updaterState.currentVersion}`}
          </span>
        </div>
        <div className="about-app__actions">
          <button onClick={() => openExternal(REPO_URL)} type="button">
            <ExternalLink aria-hidden="true" size={ICON.xs} />GitHub 仓库
          </button>
          <button onClick={() => openExternal(CHANGELOG_URL)} type="button">
            <ExternalLink aria-hidden="true" size={ICON.xs} />更新日志
          </button>
          <button className="provider-add" disabled={busy} onClick={onOpenUpdater} type="button">
            检查更新
          </button>
        </div>
      </div>

      <div className="provider-library-heading about-cli-heading">
        <h3>Agent CLI</h3>
        <div className="about-cli-heading__actions">
          <span>{model.releases ? `${model.releases.length} 个 · ${platformLabel()}` : "正在检测"}</span>
          <button
            disabled={model.loading || busy}
            onClick={() => void model.refresh()}
            title="重新检测本地与 registry 版本"
            type="button"
          >
            <RefreshCw aria-hidden="true" className={model.loading ? "environment-spin" : undefined} size={ICON.xs} />
            刷新
          </button>
          {upgradable > 0 ? (
            <button
              className="provider-add"
              disabled={busy}
              onClick={() => void installAll(model)}
              type="button"
            >
              全部升级 ({upgradable})
            </button>
          ) : null}
        </div>
      </div>

      {model.releases === null ? (
        <p className="provider-empty">{model.loading ? "正在检测本地 CLI 与 registry 版本…" : "暂无检测结果。"}</p>
      ) : (
        <div className="about-list">
          {model.releases.map((release) => (
            <AgentCard
              installing={model.installing}
              key={release.kind}
              onInstall={() => void model.install(release.kind)}
              release={release}
              result={model.result}
            />
          ))}
        </div>
      )}

      {model.failure ? (
        <p className="about-error" role="alert">{failureLabel(model.failure)}</p>
      ) : null}
    </section>
  );
}

async function installAll(model: ReturnType<typeof useAgentReleases>) {
  // 后端同时只允许一个安装任务，串行跑才不会互相踩。
  for (const release of model.releases ?? []) {
    if (release.state !== "upgradable") continue;
    // eslint-disable-next-line no-await-in-loop
    await model.install(release.kind);
  }
}

function AgentCard({
  release,
  installing,
  result,
  onInstall,
}: {
  installing: ReturnType<typeof useAgentReleases>["installing"];
  release: AgentRelease;
  result: ReturnType<typeof useAgentReleases>["result"];
  onInstall: () => void;
}) {
  const Icon = AGENT_ICON[release.kind];
  const busy = installing === release.kind;
  const failed = result?.kind === release.kind && !result.success;
  const actionable = release.state === "upgradable" || release.state === "missing";
  const actionLabel = release.state === "missing" ? "安装" : release.state === "upgradable" ? "升级" : RELEASE_LABEL[release.state];

  return (
    <article className="provider-card about-card" data-state={release.state}>
      <header className="about-card__head">
        <Icon aria-hidden="true" size={ICON.md} />
        <strong className="about-card__name">{release.displayName}</strong>
        <span className="about-card__version" title="当前版本">
          {release.currentVersion ?? "未安装"}
        </span>
        <span aria-hidden="true" className="about-card__state">
          <StateIcon state={release.state} />
        </span>
      </header>

      <dl className="about-card__meta">
        <div><dt>最新版本</dt><dd>{release.latestVersion ?? "—"}</dd></div>
        <div><dt>状态</dt><dd>{RELEASE_LABEL[release.state]}</dd></div>
      </dl>

      {release.notice ? <p className="about-card__notice">{release.notice}</p> : null}
      {failed ? (
        <pre className="about-card__log">
          {result!.log.split("\n").slice(-12).join("\n")}
        </pre>
      ) : null}

      <div className="provider-card__actions">
        <button
          className="provider-card__activate"
          disabled={!actionable || busy}
          onClick={onInstall}
          title={release.installCommand ?? undefined}
          type="button"
        >
          {busy ? <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.sm} /> : null}
          {busy ? "正在安装" : actionLabel}
        </button>
        {failed && release.installCommand ? (
          <button
            onClick={() => void copyToTerminal(release.installCommand!)}
            title="复制安装命令，到终端里粘贴执行"
            type="button"
          >
            在终端中重试
          </button>
        ) : null}
      </div>
    </article>
  );
}

function StateIcon({ state }: { state: ReleaseState }) {
  if (state === "ready") return <CheckCircle2 aria-hidden="true" size={ICON.md} />;
  if (state === "upgradable") return <ArrowUpCircle aria-hidden="true" size={ICON.md} />;
  if (state === "missing") return <Download aria-hidden="true" size={ICON.md} />;
  if (state === "unmanaged") return <AlertTriangle aria-hidden="true" size={ICON.md} />;
  return <HelpCircle aria-hidden="true" size={ICON.md} />;
}

async function copyToTerminal(command: string) {
  await navigator.clipboard.writeText(command);
}
