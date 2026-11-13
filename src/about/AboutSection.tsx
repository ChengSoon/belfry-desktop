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
import { useEffect } from "react";
import { AGENT_ICONS } from "../workspace/components/AgentIcons";
import { SettingsHeader } from "../settings/SettingsHeader";
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
import { Notice } from "../components/Notice";
import "../settings/obsidianSections.css";
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

  return (
    <section className="about-section os-page" aria-label={t("about.AboutSection.text_52d25a9e30")}>
      <SettingsHeader
        title={t("about.AboutSection.text_52d25a9e30")}
        description={t("about.AboutSection.text_ec8fdf4ff2")}
      />

      <div className="os-group">
        <div className="about-app">
          <img alt="" className="about-app__icon" src={appIconUrl} />
          <div className="about-app__copy">
            <strong>Belfry</strong>
            <p>{t("about.AboutSection.text_342a0e3ee8")}</p>
            <span className="os-tag about-app__version">{t("about.AboutSection.text_45bf8d8881", { currentVersion: updaterState.currentVersion })}</span>
          </div>
          <div className="about-app__actions">
            <button className="os-btn" onClick={() => void openExternal(DOCS_URL)} type="button">{t("about.AboutSection.text_acbf912bf3")}</button>
            <button className="os-btn" onClick={() => void openExternal(REPO_URL)} type="button">{t("about.AboutSection.text_720f02a99a")}</button>
            <button className="os-btn" onClick={() => void openExternal(CHANGELOG_URL)} type="button">{t("about.AboutSection.text_de6811e73d")}</button>
            <button className="os-btn primary" disabled={busy} onClick={onOpenUpdater} type="button">{t("about.AboutSection.text_7f68ebad19")}</button>
          </div>
        </div>
      </div>

      {updaterState.availableVersion ? (
        <Notice className="about-app__version--available" tone="info"
          action={<button type="button" disabled={busy} onClick={onOpenUpdater}>{t("updater.UpdateDialog.text_ac69f68b70")}</button>}>
          <strong>{t("about.AboutSection.updateAvailable", { version: updaterState.availableVersion })}</strong>
          {t("about.AboutSection.updateAvailableHint")}
        </Notice>
      ) : null}

      <section className="os-section">
        <div className="os-group-head about-cli-heading">
          <h3>Agent CLI</h3>
          <span className="os-meta about-cli-heading__actions">
            <span>{model.releases ? t("about.AboutSection.text_4673b19698", { count: model.releases.length, platform: platformLabel() }) : t("about.AboutSection.text_2b5941013c")}</span>
            <button
              className="os-btn"
              disabled={model.loading || busy}
              onClick={() => void model.refresh()}
              title={t("about.AboutSection.text_32371085de")}
              type="button"
            >
              <RefreshCw aria-hidden="true" className={model.loading ? "environment-spin" : undefined} size={ICON.xs} />{t("about.AboutSection.text_aee8874341")}</button>
          </span>
        </div>

        {model.releases === null ? (
          <div className="os-group"><p className="os-empty">{model.loading ? t("about.AboutSection.text_abb8e4e2ab") : t("about.AboutSection.text_0220c76d0a")}</p></div>
        ) : (
          <div className="os-group about-list">
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
        {upgradable > 0 ? (
          <div className="os-actions">
            <button className="os-btn secondary" disabled={busy} onClick={() => void installAll(model)} type="button">
              {t("about.AboutSection.upgradeAll", { count: upgradable })}
            </button>
          </div>
        ) : null}
      </section>

      {model.failure ? (
        <Notice className="about-error" role="alert">{failureLabel(model.failure)}</Notice>
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
  useTranslation();
  const Icon = AGENT_ICONS[release.kind];
  const busy = installing === release.kind;
  const failed = result?.kind === release.kind && !result.success;
  const actionable = release.state === "upgradable" || release.state === "missing";
  const actionLabel = release.state === "missing" ? t("about.AboutSection.text_e8f88f51cc") : release.state === "upgradable" ? t("about.AboutSection.text_94996ca622") : RELEASE_LABEL[release.state];

  return (
    <article className="about-card" data-state={release.state}>
      <span className={`os-agent${release.kind === "claude" ? " claude" : ""}`}><Icon aria-hidden="true" size={ICON.sm} /></span>
      <div className="about-card__head">
        <strong className="about-card__name">{release.displayName}</strong>
        <span className="about-card__version" title={t("about.AboutSection.text_837bc95767")}>
          {release.currentVersion ?? t("about.AboutSection.text_156219e305")}
        </span>
      </div>

      <dl className="about-card__meta">
        <div><dt>{t("about.AboutSection.text_c2a497830e")}</dt><dd>{release.latestVersion ?? "—"}</dd></div>
      </dl>

      <div className="about-card__actions">
        {actionable || busy ? <button
          className="os-btn secondary about-card__install"
          aria-busy={busy || undefined}
          disabled={installing !== null}
          onClick={onInstall}
          title={release.installCommand ?? undefined}
          type="button"
        >
          {busy ? <LoaderCircle aria-hidden="true" className="environment-spin" size={ICON.sm} /> : null}
          <span>{busy ? (release.state === "missing" ? t("about.AboutSection.text_afa17e72ae") : t("about.AboutSection.text_bc572b56dd")) : actionLabel}</span>
        </button> : (
          <span className="about-card__state">
            <StateIcon state={release.state} />
            {RELEASE_LABEL[release.state]}
          </span>
        )}
        {failed && release.installCommand ? (
          <button
            className="os-btn"
            onClick={() => void copyToTerminal(release.installCommand!)}
            title={t("about.AboutSection.text_cfd7b08d21")}
            type="button"
          >{t("about.AboutSection.text_285e03314f")}</button>
        ) : null}
      </div>

      {release.notice ? <p className="about-card__notice">{release.notice}</p> : null}
      {failed ? (
        <pre className="about-card__log">
          {result!.log.split("\n").slice(-12).join("\n")}
        </pre>
      ) : null}
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
