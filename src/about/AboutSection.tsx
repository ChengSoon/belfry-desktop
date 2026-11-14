import { t, useTranslation } from "../i18n";
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
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePluginRuntime } from "../plugins/usePluginRuntime";
import { AGENT_ICONS } from "../workspace/components/AgentIcons";
import { SButton, SGroupTitle, SItem, SList, STag } from "../settings/kit";
import { ICON } from "../theme/sizing";
import type { UpdaterState } from "../updater/contracts";
import { failureLabel } from "../workspace/errors";
import appIconUrl from "../../src-tauri/icons/128x128.png";
import {
  CHANGELOG_URL,
  countUpgradable,
  DOCS_URL,
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

export function AboutSection({ updaterState, updaterOpen, onOpenUpdater, onGuardChange }: AboutSectionProps) {
  useTranslation();
  const model = useAgentReleases(true);
  // 更新对话框叠在设置页之上时，Escape 只关对话框，别把设置页也一起关了。
  useEffect(() => {
    onGuardChange(updaterOpen);
    return () => onGuardChange(false);
  }, [updaterOpen, onGuardChange]);

  const upgradable = model.releases ? countUpgradable(model.releases) : 0;
  const busy = model.installing !== null;

  // 稿（settings-v3/settings.html?page=about，T42）：产品卡 →「运行状态」→「Agent CLI」→「链接」。
  return (
    <div className="about-section">
      <SList>
        <div className="sk-hero about-app">
          <img alt="" className="sk-logo about-app__icon" src={appIconUrl} />
          <div className="about-app__copy">
            <b>Belfry</b>
            <span className="sk-hero-sub">{t("about.AboutSection.text_342a0e3ee8")} · <span className="sk-mono">v{updaterState.currentVersion}</span></span>
          </div>
          <div className="sk-r">
            {updaterState.availableVersion
              ? <STag tone="accent">{t("about.AboutSection.updateAvailable", { version: updaterState.availableVersion })}</STag>
              : <STag tone="ok" dot>{t("about.AboutSection.upToDate")}</STag>}
            <SButton tone={updaterState.availableVersion ? "primary" : "secondary"} disabled={busy} onClick={onOpenUpdater}>
              {updaterState.availableVersion ? t("updater.UpdateDialog.text_ac69f68b70") : t("about.AboutSection.text_7f68ebad19")}</SButton>
          </div>
        </div>
      </SList>

      <SGroupTitle>{t("about.AboutSection.runtime")}</SGroupTitle>
      <RuntimeStatus />

      <SGroupTitle tail={<>
        <span>{model.releases ? t("about.AboutSection.text_4673b19698", { count: model.releases.length, platform: platformLabel() }) : t("about.AboutSection.text_2b5941013c")}</span>
        {upgradable > 0 ? <SButton disabled={busy} onClick={() => void installAll(model)}>{t("about.AboutSection.upgradeAll", { count: upgradable })}</SButton> : null}
        <SButton disabled={model.loading || busy} icon onClick={() => void model.refresh()} title={t("about.AboutSection.text_32371085de")} aria-label={t("about.AboutSection.text_aee8874341")}>
          <RefreshCw aria-hidden="true" className={model.loading ? "environment-spin" : undefined} size={ICON.xs} /></SButton>
      </>}>Agent CLI</SGroupTitle>
      <SList>
        {model.releases === null
          ? <p className="sk-empty">{model.loading ? t("about.AboutSection.text_abb8e4e2ab") : t("about.AboutSection.text_0220c76d0a")}</p>
          : model.releases.map((release) => <AgentCard installing={model.installing} key={release.kind} onInstall={() => void model.install(release.kind)} release={release} result={model.result} />)}
      </SList>
      {model.failure ? <p className="sk-note is-danger about-error" role="alert">{failureLabel(model.failure)}</p> : null}

      <SGroupTitle>{t("about.AboutSection.links")}</SGroupTitle>
      <SList>
        {[[t("about.AboutSection.text_acbf912bf3"), DOCS_URL], [t("about.AboutSection.text_720f02a99a"), REPO_URL], [t("about.AboutSection.text_de6811e73d"), CHANGELOG_URL]].map(([label, url]) =>
          <button className="sk-item is-link about-link" key={url} onClick={() => void openExternal(url)} type="button">
            <span className="sk-l"><b>{label}</b><span className="sk-mono">{url}</span></span><ExternalLink aria-hidden="true" size={ICON.sm} /></button>)}
      </SList>
    </div>
  );
}

/** 运行状态：后台终端（terminal_background_sessions）与插件宿主（插件运行时目录）。 */
function RuntimeStatus() {
  useTranslation();
  const runtime = usePluginRuntime();
  const [sessions, setSessions] = useState<{ status: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    void invoke<{ session: { status: string } }[]>("terminal_background_sessions")
      .then((entries) => { if (live) setSessions(entries.map((entry) => entry.session)); })
      .catch(() => { if (live) setSessions([]); });
    return () => { live = false; };
  }, []);
  const running = sessions?.filter((session) => session.status === "running").length ?? 0;
  return <SList>
    <SItem title={t("about.AboutSection.daemon")} hint={t("about.AboutSection.daemonHint")}>
      {sessions === null ? <STag>{t("about.AboutSection.checking")}</STag> : <STag tone="ok" dot>{t("about.AboutSection.daemonRunning", { count: running })}</STag>}
    </SItem>
    <SItem title={t("about.AboutSection.pluginHost")} hint={runtime.error ?? t("about.AboutSection.pluginHostHint")}>
      {runtime.available ? <STag tone="ok" dot>{t("about.AboutSection.pluginHostOk", { count: runtime.plugins.length })}</STag>
        : <STag tone={runtime.error ? "warn" : undefined} dot={Boolean(runtime.error)}>{runtime.error ? t("about.AboutSection.pluginHostDown") : t("about.AboutSection.checking")}</STag>}
    </SItem>
  </SList>;
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
  useTranslation();
  const Icon = AGENT_ICONS[release.kind];
  const busy = installing === release.kind;
  const failed = result?.kind === release.kind && !result.success;
  const actionable = release.state === "upgradable" || release.state === "missing";
  const actionLabel = release.state === "missing" ? t("about.AboutSection.text_e8f88f51cc") : release.state === "upgradable" ? t("about.AboutSection.text_94996ca622") : RELEASE_LABEL[release.state];

  return (
    <article className="sk-item about-card" data-state={release.state}>
      <span className={`sk-ic${release.kind === "claude" ? " is-claude" : ""}`}><Icon aria-hidden="true" size={ICON.sm} /></span>
      <div className="sk-l">
        <b className="about-card__name">{release.displayName}</b>
        <span className="sk-mono about-card__version" title={t("about.AboutSection.text_837bc95767")}>
          {release.currentVersion ?? t("about.AboutSection.text_156219e305")}{release.state === "upgradable" && release.latestVersion ? ` → ${release.latestVersion}` : ""}</span>
        {release.notice ? <span className="about-card__notice">{release.notice}</span> : null}
        {failed ? <pre className="sk-code about-card__log">{result!.log.split("\n").slice(-12).join("\n")}</pre> : null}
      </div>
      <div className="sk-r about-card__actions">
        {actionable || busy ? <SButton className="about-card__install" aria-busy={busy || undefined} disabled={installing !== null} onClick={onInstall}
          title={release.installCommand ?? undefined} tone="secondary">
          {busy ? <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.sm} /> : null}
          <span>{busy ? (release.state === "missing" ? t("about.AboutSection.text_afa17e72ae") : t("about.AboutSection.text_bc572b56dd")) : actionLabel}</span>
        </SButton> : <STag tone={release.state === "ready" ? "ok" : release.state === "unmanaged" ? "warn" : undefined} dot={release.state === "ready"}>{RELEASE_LABEL[release.state]}</STag>}
        {failed && release.installCommand ? <SButton onClick={() => void copyToTerminal(release.installCommand!)} title={t("about.AboutSection.text_cfd7b08d21")}>{t("about.AboutSection.text_285e03314f")}</SButton> : null}
      </div>
    </article>
  );
}

function StateIcon({ state }: { state: ReleaseState }) {
  useTranslation();
  if (state === "ready") return <CheckCircle2 aria-hidden="true" size={ICON.md} />;
  if (state === "upgradable") return <ArrowUpCircle aria-hidden="true" size={ICON.md} />;
  if (state === "missing") return <Download aria-hidden="true" size={ICON.md} />;
  if (state === "unmanaged") return <AlertTriangle aria-hidden="true" size={ICON.md} />;
  return <HelpCircle aria-hidden="true" size={ICON.md} />;
}

async function copyToTerminal(command: string) {
  await navigator.clipboard.writeText(command);
}
