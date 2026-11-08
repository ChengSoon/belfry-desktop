import { useFeedback, t, useTranslation } from "../../i18n";
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
import { guardComposingEnter } from "../../utils/keyboard";
import { AGENT_KINDS, AGENT_METADATA } from "../../agent/contracts";

interface Props {
  initial: PriceDraft; rows: UsageBucket[]; projects: { root: string; name: string }[];
  onSave: (rule: PriceRule) => string | null; onCancel: () => void; onRemove?: () => string | null;
}

export function PriceRuleForm(props: Props) {
  useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(props.initial);
  const [error, setError] = useFeedback<string | null>(null);
  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus(); }, []);
  const update = (patch: Partial<PriceDraft>) => { setDraft((value) => ({ ...value, ...patch })); setError(null); };
  const save = () => {
    const invalid = priceFormError(draft);
    if (invalid) { setError(() => priceFormError(draft)); return; }
    try { setError(props.onSave(priceFromDraft(draft))); }
    catch (failure) { setError(() => failure instanceof Error ? failure.message : String(failure)); }
  };
  return <form ref={formRef} onKeyDown={guardComposingEnter} className="usage-price-form" aria-label={t("usage.PriceRuleForm.text_e316c89141")} noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
    <PriceIdentityFields draft={draft} rows={props.rows} update={update} projects={props.projects} />
    <div className="usage-price-form__pair usage-price-form__pair--date">
      <label>{t("usage.PriceRuleForm.text_e8ec4fe3da")}<DatePicker value={draft.effectiveFrom} required ariaLabel={t("usage.PriceRuleForm.text_3d278ad9bb")} todayMode="utc"
        onChange={(effectiveFrom) => update({ effectiveFrom })} /></label>
      <label>{t("usage.PriceRuleForm.text_9677f386bd")}<Select<PriceRule["currency"]> value={draft.currency} ariaLabel={t("usage.PriceRuleForm.text_9677f386bd")} onChange={(currency) => update({ currency })}
        options={[{ value: "USD", label: t("usage.PriceRuleForm.text_45c848e6fb") }, { value: "CNY", label: t("usage.PriceRuleForm.text_f3328e4b22") }]} /></label>
    </div>
    <fieldset><legend>{t("usage.PriceRuleForm.text_4616981eb4")}</legend><div className="usage-price-form__pair">
      {RATE_FIELDS.map(({ key, label }) => <label key={key}>{label}<NumericField min={0} max={MAX_RATE} steppers={false} ariaLabel={t("usage.PriceRuleForm.text_e41655a8c0", { label: label })}
        value={draft.rates[key]} required onChange={(value) => update({ rates: { ...draft.rates, [key]: value } })} /></label>)}
    </div></fieldset>
    <label>{t("usage.PriceRuleForm.text_e209aeeb37")}<input value={draft.source} aria-required="true" maxLength={500} placeholder={t("usage.PriceRuleForm.text_58e8718f0a")}
      onChange={(event) => update({ source: event.target.value })} /></label>
    <Disclosure title={t("usage.PriceRuleForm.text_2f9bd68a1a")}><label>{t("usage.PriceRuleForm.text_0e4719aac4")}<textarea value={draft.aliases} rows={2}
      onChange={(event) => update({ aliases: event.target.value })} /></label></Disclosure>
    <p className="usage-note">{t("usage.PriceRuleForm.text_914a10d27f")}</p>
    {error ? <p className="usage-price-error" role="alert">{error}</p> : null}
    <footer><button type="button" onClick={props.onCancel}>{t("usage.PriceRuleForm.text_2cd0f3be87")}</button><button type="submit">{t("usage.PriceRuleForm.text_8d145825fd")}</button></footer>
    {props.onRemove ? <RemoveRule onRemove={() => setError(props.onRemove!())} /> : null}
  </form>;
}

function PriceIdentityFields({ draft, update, rows, projects }: {
  draft: PriceDraft; update: (patch: Partial<PriceDraft>) => void;
  rows: UsageBucket[]; projects: Props["projects"];
}) {
  useTranslation();
  const models = [...new Set(rows.filter((row) => row.agent === draft.agent).map((row) => row.model))];
  const hasProject = projects.some((project) => project.root === draft.projectRoot);
  return <>
    <label>Agent<Select<PriceRule["agent"]> value={draft.agent} ariaLabel="Agent" onChange={(agent) => update({ agent })}
      options={AGENT_KINDS.map((kind) => ({ value: kind, label: AGENT_METADATA[kind].name }))} /></label>
    <label>{t("usage.PriceRuleForm.text_90bd954a58")}<Combobox value={draft.model} required maxLength={512} ariaLabel={t("usage.PriceRuleForm.text_90bd954a58")} placeholder={t("usage.PriceRuleForm.text_dac7cd2c9e")}
      options={models.map((model) => ({ value: model, label: model, description: agentLabel(draft.agent) }))}
      onChange={(model) => update({ model })} /></label>
    <label>{t("usage.PriceRuleForm.text_31670d6a73")}<Select value={draft.projectRoot} ariaLabel={t("usage.PriceRuleForm.text_31670d6a73")} onChange={(projectRoot) => update({ projectRoot })} options={[
      { value: "", label: t("usage.PriceRuleForm.text_e3040dfd6b") },
      ...(draft.projectRoot && !hasProject ? [{ value: draft.projectRoot, label: draft.projectRoot }] : []),
      ...projects.map((project) => ({ value: project.root, label: project.name, description: project.root })),
    ]} /></label>
  </>;
}

function RemoveRule({ onRemove }: { onRemove: () => void }) {
  useTranslation();
  const [confirm, setConfirm] = useState(false);
  return <div className="usage-price-remove">{confirm ? <>
    <p>{t("usage.PriceRuleForm.text_6901b52585")}</p>
    <button type="button" onClick={() => setConfirm(false)}>{t("usage.PriceRuleForm.text_670ec25af8")}</button><button type="button" onClick={onRemove}>{t("usage.PriceRuleForm.text_ee7dea070d")}</button>
  </> : <button type="button" onClick={() => setConfirm(true)}>{t("usage.PriceRuleForm.text_f66cb23c11")}</button>}</div>;
}
