import { localized, t, useTranslation } from "../../i18n";
import { RotateCcw } from "lucide-react";
import { ICON } from "../../theme/sizing";
import { SettingsHeader } from "../../settings/SettingsHeader";
import { useTheme } from "../../theme/ThemeProvider";
import {
  DEFAULT_TYPOGRAPHY,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from "../../typography/contracts";
import { useTypography } from "../../typography/TypographyProvider";
import { useBackground } from "../BackgroundProvider";
import { BACKGROUND_FITS, MAX_BLUR, type BackgroundFit } from "../contracts";
import { FontFamilyField, useFontChoice } from "./FontFamilyField";
import { FontImportCard } from "./FontImportCard";
import { ThemePicker } from "../../plugins/ThemePicker";
import "./appearance.css";
import { Slider as CustomSlider } from "../../components/controls/Slider";
import { LanguageSettings } from "../../i18n/LanguageSettings";

const FIT_LABEL: Record<BackgroundFit, string> = localized(() => ({
  cover: t("background.AppearanceSection.text_4ce4c98eb2"),
  contain: t("background.AppearanceSection.text_53c9aca4b6"),
  tile: t("background.AppearanceSection.text_01d70f8715"),
  center: t("background.AppearanceSection.text_4cc3885c18"),
}));

/**
 * 外观分区。全局排版与背景图都在这里即时预览并持久化。
 */
export function AppearanceSection() {
  useTranslation();
  const { config } = useBackground();

  return (
    <section aria-label={t("background.AppearanceSection.text_86a63f23a0")} className="appearance">
      {/* 这一页原先直接甩控件、没有页面标题，在八页里是唯一一个「进去不知道
          自己在哪」的。标题走统一页头；不凑说明文案——外观一进去就看得懂，
          硬加一句是 filler 不是说明。 */}
      <SettingsHeader title={t("background.AppearanceSection.text_86a63f23a0")} />
      <LanguageSettings />
      <div className="appearance__divider" />
      <ThemePicker />
      <div className="appearance__divider" />
      <TypographyControls />
      <div className="appearance__divider" />
      <BackgroundPreview />
      {config.fileName ? <BackgroundControls /> : null}
    </section>
  );
}

function TypographyControls() {
  useTranslation();
  const { config, busy, error, update, pick, clearImported, reset } = useTypography();
  const font = useFontChoice(config, update);
  const isDefault = config.fontFamily === DEFAULT_TYPOGRAPHY.fontFamily
    && config.fontSize === DEFAULT_TYPOGRAPHY.fontSize
    && config.activeImportedFont === null;

  return (
    <div aria-label={t("background.AppearanceSection.text_01cf42c6b1")} className="appearance__group" role="group">
      <TypographyHeading
        disabled={busy || isDefault}
        onReset={() => {
          font.setValue(DEFAULT_TYPOGRAPHY.fontFamily);
          void reset();
        }}
      />
      <div aria-label={t("background.AppearanceSection.text_c977f732b2")} className="appearance__type-preview">
        <strong>{t("background.AppearanceSection.text_cbd8a4ff69")}</strong>
        <span>~/project $ codex</span>
      </div>
      <FontFamilyField
        activeImportedFileName={config.activeImportedFont}
        importedFonts={config.importedFonts}
        onChange={font.setValue}
        onCommit={font.commit}
        onSelectDefault={font.selectDefault}
        onSelectImported={font.selectImported}
        onSelectSystem={font.selectSystem}
        value={font.value}
      />
      <FontImportCard
        activeFileName={config.activeImportedFont}
        assets={config.importedFonts}
        busy={busy}
        error={error}
        onClear={clearImported}
        onPick={pick}
      />
      <Slider
        format={(value) => `${value}px`}
        label={t("background.AppearanceSection.text_f71561b5af")}
        max={MAX_FONT_SIZE}
        min={MIN_FONT_SIZE}
        onChange={(fontSize) => update({ fontSize })}
        step={1}
        value={config.fontSize}
      />
    </div>
  );
}

function TypographyHeading({ disabled, onReset }: { disabled: boolean; onReset: () => void }) {
  useTranslation();
  return (
    <div className="appearance__heading">
      {/* 页面标题已经是 h2（统一页头），这条是页内小节的标题，降一档到 h3，
          免得和页面标题平级、读起来像两个并列的页面名。 */}
      <h3>{t("background.AppearanceSection.text_01cf42c6b1")}</h3>
      <button
        aria-label={t("background.AppearanceSection.text_8ffe2ff1fe")}
        className="icon-button icon-button--sm"
        disabled={disabled}
        onClick={onReset}
        title={t("background.AppearanceSection.text_8ffe2ff1fe")}
        type="button"
      >
        <RotateCcw aria-hidden="true" size={ICON.sm} />
      </button>
    </div>
  );
}

function BackgroundPreview() {
  useTranslation();
  const { config, url, busy, error, pick, clear, update } = useBackground();
  const isVideo = Boolean(url && config.mime?.startsWith("video/"));
  return (
    <div className="appearance__field">
      <span className="appearance__label">{t("background.AppearanceSection.text_bbaa9f0637")}</span>
      <div className="appearance__preview">
        {url ? (
          <>
            {isVideo ? (
              <video
                autoPlay={!config.videoPaused}
                className={`appearance__preview-video appearance__preview-video--${config.fit}`}
                loop
                muted
                playsInline
                key={String(config.videoPaused)}
                src={url ?? undefined}
              />
            ) : <div className="appearance__preview-image" />}
            <span className="appearance__preview-text">{t("background.AppearanceSection.text_066c476487")}</span>
          </>
        ) : (
          <span className="appearance__preview-empty">{t("background.AppearanceSection.text_847fba2b66")}</span>
        )}
      </div>
      <div className="appearance__actions">
        <button disabled={busy} onClick={() => void pick()} type="button">
          {config.fileName ? t("background.AppearanceSection.text_a21a41e49d") : t("background.AppearanceSection.text_fdc86813c9")}
        </button>
        {isVideo ? (
          <button
            disabled={busy}
            onClick={() => update({ videoPaused: !config.videoPaused })}
            type="button"
          >
            {config.videoPaused ? t("background.AppearanceSection.text_c3396195e9") : t("background.AppearanceSection.text_8d12fc0d4e")}
          </button>
        ) : null}
        {config.fileName ? (
          <button disabled={busy} onClick={() => void clear()} type="button">{t("background.AppearanceSection.text_6135d4159e")}</button>
        ) : null}
      </div>
      {error ? <p className="appearance__error" role="alert">{error}</p> : null}
    </div>
  );
}

function BackgroundControls() {
  useTranslation();
  const { config, update } = useBackground();
  const { mode } = useTheme();
  const fits = config.mime?.startsWith("video/")
    ? BACKGROUND_FITS.filter((fit) => fit === "cover" || fit === "contain")
    : BACKGROUND_FITS;
  return (
    <>
      <Slider
        format={(value) => `${Math.round(value * 100)}%`}
        label={t("background.AppearanceSection.text_abccbb979b")}
        max={1}
        min={0}
        onChange={(opacity) => update({ opacity })}
        step={0.01}
        value={config.opacity}
      />
      {/* 衬底浓度亮暗各记一份，这根滑块只动当前主题那一份——改的就是眼前看到的这套，
          所以标签不必标注亮/暗（.appearance__label 那一列是写死的 60px，标了会压到滑轨上）。 */}
      <Slider
        format={(value) => `${Math.round(value * 100)}%`}
        label={t("background.AppearanceSection.text_55ed590170")}
        max={1}
        min={0}
        onChange={(value) => update({ veil: { ...config.veil, [mode]: value } })}
        step={0.01}
        value={config.veil[mode]}
      />
      <Slider
        format={(value) => `${value}px`}
        label={t("background.AppearanceSection.text_36bab7a3de")}
        max={MAX_BLUR}
        min={0}
        onChange={(blur) => update({ blur })}
        step={1}
        value={config.blur}
      />
      <div className="appearance__row">
        <span className="appearance__label">{t("background.AppearanceSection.text_05fb7cba47")}</span>
        <div aria-label={t("background.AppearanceSection.text_db47d34f0f")} className="appearance__segments" role="group">
          {fits.map((fit) => (
            <button
              aria-pressed={fit === config.fit}
              className={fit === config.fit ? "is-active" : ""}
              key={fit}
              onClick={() => update({ fit })}
              type="button"
            >
              {FIT_LABEL[fit]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  useTranslation();
  return (
    <div className="appearance__row">
      <span className="appearance__label">{label}</span>
      <CustomSlider
        max={max}
        min={min}
        onChange={onChange}
        step={step}
        ariaLabel={label}
        valueText={format(value)}
        value={value}
      />
      <span className="appearance__value">{format(value)}</span>
    </div>
  );
}
