import { localized, t, useTranslation } from "../../i18n";
import { Image as ImageIcon, RotateCcw } from "lucide-react";
import { ICON } from "../../theme/sizing";
import { SButton, SGroupTitle, SItem, SList, SPage, SSegment, SSwitch } from "../../settings/kit";
import { useTheme } from "../../theme/ThemeProvider";
import {
  DEFAULT_TYPOGRAPHY,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from "../../typography/contracts";
import { useTypography } from "../../typography/TypographyProvider";
import { useBackground } from "../BackgroundProvider";
import { BACKGROUND_FITS, MAX_BLUR, type BackgroundFit } from "../contracts";
import { FontFamilyInput, useFontChoice } from "./FontFamilyField";
import { FontImportCard } from "./FontImportCard";
import { usePluginRuntime } from "../../plugins/usePluginRuntime";
import { Select } from "../../components/controls/Select";
import { selectPluginTheme, usePluginTheme } from "../../plugins/pluginTheme";
import "./appearance.css";
import { Slider as CustomSlider } from "../../components/controls/Slider";
import { LanguageSelect } from "../../i18n/LanguageSettings";
import { setInterface, useInterface } from "../../preferences/interface";

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
  // 布局严格按 docs/design/belfry-ui/settings-v3/settings.html?page=appearance（T42）：
  // 主题 → 终端排版 → 壁纸 → 界面，全部为分组标题 + 圆角列表 + 行。
  return (
    <SPage label={t("background.AppearanceSection.text_86a63f23a0")}>
      <div className="appearance">
        <SGroupTitle>{t("background.AppearanceSection.theme")}</SGroupTitle>
        <ThemeCards />
        <SGroupTitle>{t("background.AppearanceSection.terminalType")}</SGroupTitle>
        <TypographyControls />
        <SGroupTitle>{t("background.AppearanceSection.text_bbaa9f0637")}</SGroupTitle>
        <SList>
          <BackgroundRow />
          {config.fileName ? <BackgroundControls /> : null}
        </SList>
        <SGroupTitle>{t("background.AppearanceSection.interface")}</SGroupTitle>
        <InterfaceControls />
      </div>
    </SPage>
  );
}

/** 主题：三张缩略图卡（跟随系统 / 深色 / 浅色）+ 插件主题一行（原下拉保留在这一行里）。 */
function ThemeCards() {
  useTranslation();
  const theme = useTheme(), pluginTheme = usePluginTheme(), { themes } = usePluginRuntime();
  const current = pluginTheme ? null : theme.pinned ? theme.mode : "system";
  const pick = (id: "system" | "dark" | "light") => {
    if (id === "system") theme.followSystem(); else theme.select(id);
    selectPluginTheme("");
  };
  const cards = [["system", t("plugins.ThemePicker.text_217cfe7db1")], ["dark", t("plugins.ThemePicker.text_a6b75d0680")], ["light", t("plugins.ThemePicker.text_aa0819dfc4")]] as const;
  return <SList label={t("background.AppearanceSection.theme")}>
    <div className="sk-themes" role="group" aria-label={t("background.AppearanceSection.theme")}>
      {cards.map(([id, label]) => <button aria-pressed={current === id} className={`sk-th is-${id}`} key={id} onClick={() => pick(id)} type="button">
        <span aria-hidden="true" className="sk-th-p"><i /><i /></span>{label}</button>)}
    </div>
    <SItem title={t("background.AppearanceSection.pluginTheme")} hint={t("background.AppearanceSection.pluginThemeHint")}>
      <Select<string> ariaLabel={t("background.AppearanceSection.pluginTheme")} value={pluginTheme} onChange={(key) => {
          const item = themes.find((entry) => `${entry.pluginId}:${entry.id}` === key);
          if (item) theme.select(item.base ?? "dark"); selectPluginTheme(key);
        }}
        options={[{ value: "", label: t("background.AppearanceSection.pluginThemeNone") },
          ...themes.map((entry) => ({ value: `${entry.pluginId}:${entry.id}`, label: entry.label, description: entry.pluginId }))]} />
    </SItem>
  </SList>;
}

function TypographyControls() {
  useTranslation();
  const { config, busy, error, update, pick, clearImported, reset } = useTypography();
  const font = useFontChoice(config, update);
  const isDefault = config.fontFamily === DEFAULT_TYPOGRAPHY.fontFamily
    && config.fontSize === DEFAULT_TYPOGRAPHY.fontSize
    && config.activeImportedFont === null;
  return (
    <SList label={t("background.AppearanceSection.text_01cf42c6b1")}>
      <SItem title={t("background.FontFamilyField.text_078838da42")} hint={t("background.AppearanceSection.fontHint")}>
        <FontFamilyInput
          activeImportedFileName={config.activeImportedFont}
          importedFonts={config.importedFonts}
          onChange={font.setValue}
          onCommit={font.commit}
          onSelectDefault={font.selectDefault}
          onSelectImported={font.selectImported}
          onSelectSystem={font.selectSystem}
          value={font.value}
        />
      </SItem>
      <SItem title={t("background.AppearanceSection.text_f71561b5af")}>
        <RowSlider format={(value) => `${value}px`} label={t("background.AppearanceSection.text_f71561b5af")} max={MAX_FONT_SIZE} min={MIN_FONT_SIZE}
          onChange={(fontSize) => update({ fontSize })} step={1} value={config.fontSize} />
        <SButton aria-label={t("background.AppearanceSection.text_8ffe2ff1fe")} disabled={busy || isDefault} icon
          onClick={() => { font.setValue(DEFAULT_TYPOGRAPHY.fontFamily); void reset(); }} title={t("background.AppearanceSection.text_8ffe2ff1fe")}>
          <RotateCcw aria-hidden="true" size={ICON.sm} /></SButton>
      </SItem>
      <div aria-label={t("background.AppearanceSection.text_c977f732b2")} className="sk-term">
        <span className="is-accent">~/belfry</span> $ codex<br /><span className="is-ok">✓</span> {t("background.AppearanceSection.previewLine")}
      </div>
      <div className="sk-item appearance__import-row">
        <FontImportCard activeFileName={config.activeImportedFont} assets={config.importedFonts} busy={busy} error={error} onClear={clearImported} onPick={pick} />
      </div>
    </SList>
  );
}

/** 壁纸：一行，左侧说明，右侧缩略图 + 选择 / 播放 / 移除（去掉原来的大块空占位）。 */
function BackgroundRow() {
  useTranslation();
  const { config, url, busy, error, pick, clear, update } = useBackground();
  const isVideo = Boolean(url && config.mime?.startsWith("video/"));
  return <>
    <SItem title={t("background.AppearanceSection.wallpaperTitle")} hint={config.fileName ?? t("background.AppearanceSection.wallpaperHint")}>
      <span className={`appearance__thumb${url ? "" : " is-empty"}`} aria-hidden="true">
        {url ? (isVideo
          ? <video className={`appearance__preview-video appearance__preview-video--${config.fit}`} key={String(config.videoPaused)} autoPlay={!config.videoPaused} loop muted playsInline src={url ?? undefined} />
          : <span className="appearance__preview-image" />) : <ImageIcon size={ICON.md} />}
      </span>
      {isVideo ? <SButton disabled={busy} onClick={() => update({ videoPaused: !config.videoPaused })}>
        {config.videoPaused ? t("background.AppearanceSection.text_c3396195e9") : t("background.AppearanceSection.text_8d12fc0d4e")}</SButton> : null}
      {config.fileName ? <SButton disabled={busy} onClick={() => void clear()} tone="danger">{t("background.AppearanceSection.text_6135d4159e")}</SButton> : null}
      <SButton disabled={busy} onClick={() => void pick()} tone="secondary">
        {config.fileName ? t("background.AppearanceSection.text_a21a41e49d") : t("background.AppearanceSection.text_fdc86813c9")}</SButton>
    </SItem>
    {error ? <p className="sk-note is-danger appearance__error" role="alert">{error}</p> : null}
  </>;
}

function BackgroundControls() {
  useTranslation();
  const { config, update } = useBackground();
  const { mode } = useTheme();
  const fits = config.mime?.startsWith("video/")
    ? BACKGROUND_FITS.filter((fit) => fit === "cover" || fit === "contain")
    : BACKGROUND_FITS;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return <>
    <SItem title={t("background.AppearanceSection.text_abccbb979b")}>
      <RowSlider format={percent} label={t("background.AppearanceSection.text_abccbb979b")} max={1} min={0} onChange={(opacity) => update({ opacity })} step={0.01} value={config.opacity} />
    </SItem>
    {/* 衬底浓度亮暗各记一份，这根滑块只动当前主题那一份。 */}
    <SItem title={t("background.AppearanceSection.text_55ed590170")}>
      <RowSlider format={percent} label={t("background.AppearanceSection.text_55ed590170")} max={1} min={0} onChange={(value) => update({ veil: { ...config.veil, [mode]: value } })} step={0.01} value={config.veil[mode]} />
    </SItem>
    <SItem title={t("background.AppearanceSection.text_36bab7a3de")}>
      <RowSlider format={(value) => `${value}px`} label={t("background.AppearanceSection.text_36bab7a3de")} max={MAX_BLUR} min={0} onChange={(blur) => update({ blur })} step={1} value={config.blur} />
    </SItem>
    <SItem title={t("background.AppearanceSection.text_05fb7cba47")}>
      <SSegment label={t("background.AppearanceSection.text_db47d34f0f")} onChange={(fit) => update({ fit })} value={config.fit}
        options={fits.map((fit) => ({ value: fit, label: FIT_LABEL[fit] }))} />
    </SItem>
  </>;
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

/** 行内滑块：控件 + 数值（标题在行左侧）。 */
function RowSlider({ label, value, min, max, step, format, onChange }: SliderProps) {
  useTranslation();
  return <span className="appearance__slider">
    <CustomSlider ariaLabel={label} max={max} min={min} onChange={onChange} step={step} value={value} valueText={format(value)} />
    <output className="appearance__value">{format(value)}</output>
  </span>;
}

/** 界面：语言 + 减少动效 + 紧凑侧栏（与稿子同组同序）。偏好即时生效。 */
function InterfaceControls() {
  useTranslation();
  const prefs = useInterface();
  return <SList label={t("background.AppearanceSection.interface")}>
    <SItem title={t("common.language")}><LanguageSelect /></SItem>
    <SItem id="pref-reduceMotion" title={t("background.AppearanceSection.reduceMotion")} hint={t("background.AppearanceSection.reduceMotionHint")}>
      <SSwitch checked={prefs.reduceMotion} labelledBy="pref-reduceMotion" onChange={(reduceMotion) => setInterface({ reduceMotion })} />
    </SItem>
    <SItem id="pref-compactSidebar" title={t("background.AppearanceSection.compactSidebar")} hint={t("background.AppearanceSection.compactSidebarHint")}>
      <SSwitch checked={prefs.compactSidebar} labelledBy="pref-compactSidebar" onChange={(compactSidebar) => setInterface({ compactSidebar })} />
    </SItem>
  </SList>;
}
