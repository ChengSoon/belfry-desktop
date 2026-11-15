import { ArrowRight, Check, ChevronDown, Eye, EyeOff, Info, MessageSquareText, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Waypoints } from "lucide-react";
import { LinkField } from "./LinkField";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { t, useTranslation } from "../i18n";
import { Select } from "../components/controls/Select";
import { guardComposingEnter } from "../utils/keyboard";
import type { ProjectWorkspace } from "../workspace/contracts";
import type { ConnectionInfo, Discovery } from "./contracts";
import { canKeepCredential, cardSkills, cardText, type ConnectionForm, type FormIssue } from "./model";
import { useConnections } from "./useConnections";
import { useLocalAgents } from "./useLocalAgents";
import { a2aErrorMessage } from "./feedback";
import { A2AButton, A2AStatus, NodeAvatar } from "./kit";
import { localAgentReason, peersOf, peerStatusText, visiblePeers, type Peer } from "./peers";
import "./a2a.css";

export function A2ASection({ project, onGuardChange, onBackToProject }: {
  project: ProjectWorkspace | null; onGuardChange: (guarded: boolean) => void; onBackToProject?: () => void;
}) {
  useTranslation();
  if (!project) return <div className="a2a-empty"><Waypoints size={18} aria-hidden="true" /><p>{t("a2a.noProject")}</p></div>;
  return <ProjectConnections key={project.rootPath} project={project} onGuardChange={onGuardChange} onBackToProject={onBackToProject} />;
}

function ProjectConnections({ project, onGuardChange, onBackToProject }: {
  project: ProjectWorkspace; onGuardChange: (guarded: boolean) => void; onBackToProject?: () => void;
}) {
  useTranslation();
  const state = useConnections(project.rootPath, onGuardChange), locked = !!state.editor || !!state.removing || !!state.busy;
  const local = useLocalAgents(project.rootPath);
  const peers = useMemo(() => peersOf(local.discovery, state.connections), [local.discovery, state.connections]);
  const [selected, setSelected] = useState<string | null>(null);
  const localPeers = peers.filter(peer => peer.kind === "local");
  const externalPeers = peers.filter(peer => peer.kind === "external");
  const readyCount = localPeers.filter(peer => peer.state === "ready").length;

  useEffect(() => {
    if (!selected || selected.startsWith("more:")) return;
    if (!peers.some(peer => peer.key === selected)) setSelected(null);
  }, [peers, selected]);

  const selectedPeer = peers.find(peer => peer.key === selected) ?? null;
  const moreKind = selected?.startsWith("more:") ? selected.slice(5) as Peer["kind"] : null;
  const morePeers = moreKind ? visiblePeers(peers, moreKind).hidden : [];
  const toggle = (key: string) => setSelected(current => current === key ? null : key);

  return <div className="a2a-section">
      {!state.editor && !state.removing ? <div className="a2a-intro"><p>{t("a2a.description")}</p><div className="a2a-actions">
        <A2AButton aria-label={t("a2a.refresh")} disabled={locked || state.loading || local.loading} onClick={() => void Promise.all([state.refresh(), local.refresh()])}>
          <RefreshCw size={14} aria-hidden="true" className={state.loading || local.loading ? "a2a-spinner" : undefined} />{t("a2a.refresh")}</A2AButton>
        <A2AButton tone="primary" disabled={locked || state.loading} onClick={() => state.add()}><Plus size={14} aria-hidden="true" />{t("a2a.add")}</A2AButton>
      </div></div> : null}
      {state.failure ? <p className="a2a-alert is-danger" role="alert">{state.failure}</p> : null}
      {state.notice ? <p className="a2a-alert" role="status"><Check size={14} aria-hidden="true" />{state.notice}</p> : null}
      {!state.editor && !state.removing ? <>
      <div className="a2a-map">
        <LinkField project={project} peers={peers} selected={selected} onSelect={toggle} />
        <div className="a2a-map__legend">
          <span className="a2a-map__stat"><i className="a2a-dot is-ready" aria-hidden="true" />{t("a2a.workspace.available")}<b>{readyCount}</b></span>
          <span className="a2a-map__protocol" aria-hidden="true">A2A · 1.0</span>
        </div>
      </div>
      {local.failure ? <p className="a2a-alert is-danger" role="alert">{local.failure}<span>{t("a2a.local.failureHint")}</span></p> : null}
      {selectedPeer ? <ul className="a2a-agent-list a2a-inspect" aria-label={t("a2a.workspace.connectionDetails")}>
        <PeerRow peer={selectedPeer} locked={locked} onEdit={connection => state.edit(connection)}
          onRemove={connection => state.requestRemove(connection)} />
      </ul> : null}
      {moreKind && morePeers.length ? <ul className="a2a-agent-list a2a-inspect" aria-label={t("a2a.workspace.morePeers", { count: morePeers.length })}>
        {morePeers.map(peer => <PeerRow key={peer.key} peer={peer} locked={locked}
          onEdit={connection => state.edit(connection)} onRemove={connection => state.requestRemove(connection)} />)}
      </ul> : null}
      {externalPeers.length === 0 && localPeers.length === 0 && !local.loading && !state.loading
        ? <p className="a2a-first-link"><ArrowRight size={13} aria-hidden="true" />{t("a2a.empty")}</p> : null}
      {onBackToProject && localPeers.length === 0 && externalPeers.length === 0
        ? <p className="a2a-first-link"><button type="button" className="a2a-text-link" onClick={onBackToProject}>{t("a2a.workspace.backToProject")}</button></p> : null}
      </> : null}
      {state.editor ? <div className="a2a-editor-layout"><ConnectionEditor key={state.editor.original?.id ?? "new"} form={state.editor.form} original={state.editor.original}
        busy={state.busy} issue={state.issue} onChange={state.change} onCheck={() => void state.check()} onSave={() => void state.save()}
        onCancel={state.closeEditor} onCancelCheck={state.cancelCheck} />
        <aside className="a2a-editor-preview">{state.discovery ? <DiscoveryPanel discovery={state.discovery} onSelectInterface={(url, tenant) => state.selectInterface(url, tenant)} />
          : <div className="a2a-preview-empty"><span className="a2a-empty__icon"><ShieldCheck size={18} aria-hidden="true" /></span>
            <h3>{t("a2a.workspace.previewTitle")}</h3><p>{t("a2a.workspace.previewHint")}</p>
            <ol><li>{t("a2a.workspace.stepAddress")}</li><li>{t("a2a.workspace.stepAuth")}</li><li>{t("a2a.workspace.stepCheck")}</li></ol>
            <p className="a2a-preview-empty__note"><Info size={14} aria-hidden="true" />{t("a2a.checkHint")}</p></div>}</aside>
      </div> : state.removing ? <div className="a2a-confirm" role="group" aria-label={t("a2a.removeTitle", { name: state.removing.name })}>
        <span className="a2a-empty__icon is-danger"><Trash2 size={18} aria-hidden="true" /></span>
        <h3>{t("a2a.removeTitle", { name: state.removing.name })}</h3><p>{t("a2a.removeHint")}</p>
        <div className="a2a-actions"><A2AButton disabled={!!state.busy} onClick={state.cancelRemove}>{t("a2a.cancel")}</A2AButton>
          <A2AButton tone="danger" disabled={!!state.busy} onClick={() => void state.confirmRemove()}>{state.busy === "remove" ? t("a2a.removing") : t("a2a.removeConfirm")}</A2AButton></div>
      </div> : null}
      <details className="a2a-help"><summary tabIndex={0}><MessageSquareText size={14} aria-hidden="true" />{t("a2a.workspace.howTo")}<ChevronDown size={14} aria-hidden="true" /></summary><p>{t("a2a.toolsHint")}</p></details>
    </div>;
}

function PeerRow({ peer, locked, onEdit, onRemove }: {
  peer: Peer; locked: boolean; onEdit: (connection: ConnectionInfo) => void; onRemove: (connection: ConnectionInfo) => void;
}) {
  useTranslation();
  const connection = peer.connection;
  const tone = peer.kind === "external" && connection?.auth.kind === "none" ? "neutral" : peer.state === "ready" ? "ok" : "warn";
  return <li className="a2a-link-card" data-state={peer.state}>
    <NodeAvatar name={peer.name} size="md" state={peer.state} />
    <div className="a2a-link-card__body">
      <h3>{peer.name}</h3>
      {peer.kind === "external"
        ? <span className="a2a-url" title={peer.url}>{peer.url}</span>
        : <span className="a2a-agent-kind">{peer.agent}</span>}
      {peer.reason ? <p className="a2a-local-reason">{localAgentReason(peer.reason)}</p> : null}
      {connection ? <details className="a2a-row-details"><summary tabIndex={0}>{t("a2a.workspace.connectionDetails")}</summary><code>{t("a2a.connectionId", { id: connection.id })}</code>
        {connection.interfaceUrl ? <code>{connection.interfaceUrl}</code> : null}</details> : null}
    </div>
    <A2AStatus state={tone}>{peerStatusText(peer)}</A2AStatus>
    {connection && peer.kind === "external" ? <div className="a2a-row-actions">
      <A2AButton disabled={locked} aria-label={t("a2a.editNamed", { name: peer.name })} onClick={() => onEdit(connection)}><Pencil size={13} aria-hidden="true" />{t("a2a.edit")}</A2AButton>
      <A2AButton tone="danger" icon disabled={locked} title={t("a2a.removeNamed", { name: peer.name })} aria-label={t("a2a.removeNamed", { name: peer.name })} onClick={() => onRemove(connection)}><Trash2 size={14} aria-hidden="true" /></A2AButton>
    </div> : null}
  </li>;
}

function Field({ field, label, hint, issue, children }: { field: keyof ConnectionForm; label: string; hint?: string; issue: FormIssue | null; children: ReactNode }) {
  const invalid = issue?.field === field;
  return <div className="a2a-field"><label htmlFor={`a2a-${field}`}>{label}</label>{children}
    {invalid || hint ? <p id={`a2a-${field}-hint`} className={invalid ? "a2a-field-error" : undefined} role={invalid ? "alert" : undefined}>{invalid ? t(issue.key) : hint}</p> : null}
  </div>;
}

export function ConnectionEditor({ form, original, busy, issue, onChange, onCheck, onSave, onCancel, onCancelCheck }: {
  form: ConnectionForm; original: ConnectionInfo | null; busy: string | null; issue: FormIssue | null;
  onChange: (patch: Partial<ConnectionForm>) => void; onCheck: () => void; onSave: () => void; onCancel: () => void; onCancelCheck: () => void;
}) {
  useTranslation();
  const [visible, setVisible] = useState(false), keep = canKeepCredential(form, original);
  useEffect(() => { if (issue) document.getElementById(`a2a-${issue.field}`)?.focus(); }, [issue]);
  const field = (name: keyof ConnectionForm) => ({
    id: `a2a-${name}`, "aria-invalid": issue?.field === name, "aria-describedby": name !== "name" || issue?.field === name ? `a2a-${name}-hint` : undefined,
    value: form[name], onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ [name]: event.target.value }),
  });
  return <form className="a2a-form" onKeyDown={guardComposingEnter} onSubmit={event => { event.preventDefault(); onSave(); }}>
    <div className="a2a-form__head"><h3>{t(original ? "a2a.editTitle" : "a2a.addTitle")}</h3></div>
    <fieldset disabled={!!busy}>
      <Field field="name" label={t("a2a.field.name")} issue={issue}><input {...field("name")} autoFocus maxLength={120} autoComplete="off" /></Field>
      <Field field="cardUrl" label={t("a2a.field.cardUrl")} hint={t("a2a.field.cardHint")} issue={issue}>
        <input {...field("cardUrl")} placeholder="https://agent.example.com/.well-known/agent-card.json" spellCheck={false} autoCapitalize="none" />
      </Field>
      <div className="a2a-field"><label htmlFor="a2a-authKind">{t("a2a.field.auth")}</label>
        <Select<string> id="a2a-authKind" ariaLabel={t("a2a.field.auth")} value={form.authKind}
          options={[
            { value: "none", label: t("a2a.auth.none") },
            { value: "bearer", label: t("a2a.auth.bearer") },
            { value: "apiKey", label: t("a2a.auth.apiKey") },
          ]}
          onChange={value => { setVisible(false); onChange({ authKind: value as ConnectionForm["authKind"] }); }} />
      </div>
      {form.authKind === "apiKey" ? <Field field="headerName" label={t("a2a.field.header")} hint={t("a2a.field.headerHint")} issue={issue}><input {...field("headerName")} spellCheck={false} /></Field> : null}
      {form.authKind !== "none" ? <>
        <div className="a2a-field"><label htmlFor="a2a-credentialAction">{t("a2a.field.credentialAction")}</label>
          <Select<string> id="a2a-credentialAction" ariaLabel={t("a2a.field.credentialAction")} value={form.credentialAction}
            options={[
              { value: "keep", label: t("a2a.credential.keep"), disabled: !keep },
              { value: "replace", label: t("a2a.credential.replace") },
              { value: "clear", label: t("a2a.credential.clear"), disabled: !original },
            ]}
            onChange={value => {
              setVisible(false); onChange({ credentialAction: value as ConnectionForm["credentialAction"], secret: "" });
            }} />
          <p>{t(original?.auth.hasCredential ? "a2a.credential.stored" : "a2a.credential.unset")}</p>
        </div>
        {form.credentialAction === "replace" ? <Field field="secret" label={t("a2a.field.secret")} hint={t("a2a.field.secretHint")} issue={issue}>
          <div className="a2a-secret"><input {...field("secret")} type={visible ? "text" : "password"} autoComplete="new-password" spellCheck={false} autoCapitalize="none" />
            <A2AButton icon aria-label={t(visible ? "a2a.credential.hide" : "a2a.credential.show")} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</A2AButton></div>
        </Field> : <p className="a2a-form-hint">{t(form.credentialAction === "keep" ? "a2a.credential.keepHint" : "a2a.credential.clearHint")}</p>}
      </> : null}
      <details className="a2a-advanced" open={!!form.interfaceUrl || !!form.interfaceTenant || issue?.field === "interfaceUrl" || issue?.field === "interfaceTenant"}><summary tabIndex={0}>{t("a2a.workspace.advanced")}<ChevronDown size={14} aria-hidden="true" /></summary>
        <Field field="interfaceUrl" label={t("a2a.field.interfaceUrl")} hint={t("a2a.field.interfaceHint")} issue={issue}>
          <input {...field("interfaceUrl")} placeholder={t("a2a.field.automatic")} spellCheck={false} autoCapitalize="none" />
        </Field>
        <Field field="interfaceTenant" label={t("a2a.field.interfaceTenant")} hint={t("a2a.field.interfaceTenantHint")} issue={issue}>
          <input {...field("interfaceTenant")} placeholder={t("a2a.field.interfaceTenantPlaceholder")} spellCheck={false} autoCapitalize="none" />
        </Field>
      </details>
    </fieldset>
    <div className="a2a-form-footer"><div className="a2a-actions">
      {busy === "probe" ? <A2AButton onClick={onCancelCheck}>{t("a2a.cancelCheck")}</A2AButton> : <A2AButton disabled={!!busy} onClick={onCheck}>{t("a2a.check")}</A2AButton>}
      <A2AButton disabled={busy === "save"} onClick={onCancel}>{t("a2a.cancel")}</A2AButton>
      <A2AButton type="submit" tone="primary" disabled={!!busy}>{busy === "save" ? t("a2a.saving") : t("a2a.save")}</A2AButton>
    </div></div>
  </form>;
}

export function DiscoveryPanel({ discovery, onSelectInterface }: { discovery: Discovery; onSelectInterface: (url: string, tenant: string) => void }) {
  useTranslation();
  const skills = cardSkills(discovery.card), issue = discovery.issue;
  const issueText = issue ? a2aErrorMessage(issue) : null;
  return <section className="a2a-discovery" aria-label={t("a2a.discovery.title")}>
    <span className="a2a-discovery-label">{t("a2a.discovery.title")}</span>
    <div className="a2a-discovery-heading"><h3>{cardText(discovery.card, "name")}</h3><A2AStatus state={issue ? "warn" : "ok"}>{t(issue ? "a2a.discovery.needsAction" : "a2a.discovery.ready")}</A2AStatus></div>
    <p>{cardText(discovery.card, "description")}</p><p>{t("a2a.discovery.version", { version: cardText(discovery.card, "version") })}</p>
    {issueText ? <p className="a2a-alert is-warn" role="alert">{issueText}</p> : null}
    {discovery.selectedInterface ? <div className="a2a-selected-interface"><b>{t("a2a.discovery.interface")}</b><code>{discovery.selectedInterface.url}</code>
      <span>A2A {discovery.selectedInterface.protocolVersion} · {discovery.selectedInterface.protocolBinding}</span>
      {discovery.selectedInterface.tenant ? <span>{t("a2a.discovery.tenant", { tenant: discovery.selectedInterface.tenant })}</span> : null}</div> : null}
    {!discovery.selectedInterface && discovery.interfaces.length > 0 ? <div className="a2a-interface-choices"><p>{t("a2a.discovery.chooseInterface")}</p>
      {discovery.interfaces.map(item => <A2AButton key={`${item.url}:${item.tenant ?? ""}`} onClick={() => onSelectInterface(item.url, item.tenant ?? "")}>
        {item.url}{item.tenant ? ` · ${item.tenant}` : ""}
      </A2AButton>)}</div> : null}
    <h4>{t("a2a.discovery.skills")}</h4>
    {skills.length ? <ul className="a2a-skills">{skills.map((skill, index) => <li key={`${cardText(skill, "id")}:${index}`}>
      <b>{cardText(skill, "name")}</b><p>{cardText(skill, "description")}</p>
      {Array.isArray(skill.tags) ? <span>{skill.tags.filter(tag => typeof tag === "string").join(" · ")}</span> : null}
    </li>)}</ul> : <p>{t("a2a.discovery.noSkills")}</p>}
    <p className="a2a-form-hint">{t("a2a.discovery.cardHint")}</p>
  </section>;
}
