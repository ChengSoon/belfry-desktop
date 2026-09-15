import { useEffect, useRef, useState } from "react";
import { agentLabel } from "../format";
import type { UsageBucket } from "../insights/contracts";
import type { PriceRule } from "./contracts";
import { MAX_RATE } from "./contracts";
import { priceFromDraft, RATE_FIELDS, type PriceDraft } from "./draft";
import { Select } from "../../components/controls/Select";
import { Combobox } from "../../components/controls/Combobox";
import { DatePicker } from "../../components/controls/DatePicker";
import { NumericField } from "../../components/controls/NumericField";
import { Disclosure } from "../../components/controls/Disclosure";
import { priceFormError } from "./priceFormValidation";

interface Props {
  initial: PriceDraft; rows: UsageBucket[]; projects: { root: string; name: string }[];
  onSave: (rule: PriceRule) => string | null; onCancel: () => void; onRemove?: () => string | null;
}

export function PriceRuleForm(props: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(props.initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus(); }, []);
  const update = (patch: Partial<PriceDraft>) => { setDraft((value) => ({ ...value, ...patch })); setError(null); };
  const save = () => {
    const invalid = priceFormError(draft);
    if (invalid) { setError(invalid); return; }
    try { setError(props.onSave(priceFromDraft(draft))); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <form ref={formRef} className="usage-price-form" aria-label="编辑模型价格" noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
    <PriceIdentityFields draft={draft} rows={props.rows} update={update} projects={props.projects} />
    <div className="usage-price-form__pair usage-price-form__pair--date">
      <label>生效日期 · UTC<DatePicker value={draft.effectiveFrom} required ariaLabel="生效日期" todayMode="utc"
        onChange={(effectiveFrom) => update({ effectiveFrom })} /></label>
      <label>币种<Select<PriceRule["currency"]> value={draft.currency} ariaLabel="币种" onChange={(currency) => update({ currency })}
        options={[{ value: "USD", label: "USD · 美元" }, { value: "CNY", label: "CNY · 人民币" }]} /></label>
    </div>
    <fieldset><legend>每百万 Token 单价</legend><div className="usage-price-form__pair">
      {RATE_FIELDS.map(({ key, label }) => <label key={key}>{label}<NumericField min={0} max={MAX_RATE} steppers={false} ariaLabel={`${label}单价`}
        value={draft.rates[key]} required onChange={(value) => update({ rates: { ...draft.rates, [key]: value } })} /></label>)}
    </div></fieldset>
    <label>价格来源<input value={draft.source} aria-required="true" maxLength={500} placeholder="报价页地址或中转服务商的费率说明"
      onChange={(event) => update({ source: event.target.value })} /></label>
    <Disclosure title="模型别名"><label>精确别名，用逗号分隔<textarea value={draft.aliases} rows={2}
      onChange={(event) => update({ aliases: event.target.value })} /></label></Disclosure>
    <p className="usage-note">仅应用于生效日期之后的记录。不同币种分别汇总，0 表示免费。</p>
    {error ? <p className="usage-price-error" role="alert">{error}</p> : null}
    <footer><button type="button" onClick={props.onCancel}>取消</button><button type="submit">保存价格</button></footer>
    {props.onRemove ? <RemoveRule onRemove={() => setError(props.onRemove!())} /> : null}
  </form>;
}

function PriceIdentityFields({ draft, update, rows, projects }: {
  draft: PriceDraft; update: (patch: Partial<PriceDraft>) => void;
  rows: UsageBucket[]; projects: Props["projects"];
}) {
  const models = [...new Set(rows.filter((row) => row.agent === draft.agent).map((row) => row.model))];
  const hasProject = projects.some((project) => project.root === draft.projectRoot);
  return <>
    <label>Agent<Select<PriceRule["agent"]> value={draft.agent} ariaLabel="Agent" onChange={(agent) => update({ agent })}
      options={[{ value: "codex", label: "Codex" }, { value: "claude", label: "Claude Code" }]} /></label>
    <label>模型名<Combobox value={draft.model} required maxLength={512} ariaLabel="模型名" placeholder="输入或选择模型"
      options={models.map((model) => ({ value: model, label: model, description: agentLabel(draft.agent) }))}
      onChange={(model) => update({ model })} /></label>
    <label>适用项目<Select value={draft.projectRoot} ariaLabel="适用项目" onChange={(projectRoot) => update({ projectRoot })} options={[
      { value: "", label: "全部项目" },
      ...(draft.projectRoot && !hasProject ? [{ value: draft.projectRoot, label: draft.projectRoot }] : []),
      ...projects.map((project) => ({ value: project.root, label: project.name, description: project.root })),
    ]} /></label>
  </>;
}

function RemoveRule({ onRemove }: { onRemove: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return <div className="usage-price-remove">{confirm ? <>
    <p>移除后，这条规则覆盖的用量会重新估算。</p>
    <button type="button" onClick={() => setConfirm(false)}>保留</button><button type="button" onClick={onRemove}>确认移除</button>
  </> : <button type="button" onClick={() => setConfirm(true)}>移除此价格</button>}</div>;
}
