import { RotateCcw } from "lucide-react";
import { ICON } from "../../theme/sizing";
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
import "./appearance.css";

const FIT_LABEL: Record<BackgroundFit, string> = {
  cover: "覆盖",
  contain: "适应",
  tile: "平铺",
  center: "居中",
};

/**
 * 外观分区。全局排版与背景图都在这里即时预览并持久化。
 */
export function AppearanceSection() {
  const { config } = useBackground();

  return (
    <section aria-label="外观" className="appearance">
      <TypographyControls />
      <div className="appearance__divider" />
      <BackgroundPreview />
      {config.fileName ? <BackgroundControls /> : null}
    </section>
  );
}

function TypographyControls() {
  const { config, busy, error, update, pick, clearImported, reset } = useTypography();
  const font = useFontChoice(config, update);
  const isDefault = config.fontFamily === DEFAULT_TYPOGRAPHY.fontFamily
    && config.fontSize === DEFAULT_TYPOGRAPHY.fontSize
    && config.activeImportedFont === null;

  return (
    <div aria-label="字体与字号" className="appearance__group" role="group">
      <TypographyHeading
        disabled={busy || isDefault}
        onReset={() => {
          font.setValue(DEFAULT_TYPOGRAPHY.fontFamily);
          void reset();
        }}
      />
      <div aria-label="字体预览" className="appearance__type-preview">
        <strong>Aa 中文 0123</strong>
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
        label="字号"
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
  return (
    <div className="appearance__heading">
      <h2>字体与字号</h2>
      <button
        aria-label="恢复默认排版"
        className="icon-button icon-button--sm"
        disabled={disabled}
        onClick={onReset}
        title="恢复默认排版"
        type="button"
      >
        <RotateCcw aria-hidden="true" size={ICON.sm} />
      </button>
    </div>
  );
}

function BackgroundPreview() {
  const { config, url, busy, error, pick, clear } = useBackground();
  return (
    <div className="appearance__field">
      <span className="appearance__label">背景图</span>
      <div className="appearance__preview">
        {url ? (
          <>
            <div className="appearance__preview-image" />
            <span className="appearance__preview-text">Aa 示例文字 the quick brown fox</span>
          </>
        ) : (
          <span className="appearance__preview-empty">还没有设置背景图</span>
        )}
      </div>
      <div className="appearance__actions">
        <button disabled={busy} onClick={() => void pick()} type="button">
          {config.fileName ? "换一张…" : "选择图片…"}
        </button>
        {config.fileName ? (
          <button disabled={busy} onClick={() => void clear()} type="button">移除</button>
        ) : null}
      </div>
      {error ? <p className="appearance__error" role="alert">{error}</p> : null}
    </div>
  );
}

function BackgroundControls() {
  const { config, update } = useBackground();
  return (
    <>
      <Slider
        format={(value) => `${Math.round(value * 100)}%`}
        label="图片可见度"
        max={1}
        min={0}
        onChange={(opacity) => update({ opacity })}
        step={0.01}
        value={config.opacity}
      />
      <Slider
        format={(value) => `${Math.round(value * 100)}%`}
        label="文字衬底"
        max={1}
        min={0}
        onChange={(veil) => update({ veil })}
        step={0.01}
        value={config.veil}
      />
      <Slider
        format={(value) => `${value}px`}
        label="模糊"
        max={MAX_BLUR}
        min={0}
        onChange={(blur) => update({ blur })}
        step={1}
        value={config.blur}
      />
      <div className="appearance__row">
        <span className="appearance__label">填充</span>
        <div aria-label="填充方式" className="appearance__segments" role="group">
          {BACKGROUND_FITS.map((fit) => (
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

/* React 把 range 的 onChange 接到原生 input 事件上，拖动过程中就会连续触发，
   所见即所得不用额外接 onInput。落盘在 Provider 那侧，见那里关于不做防抖的说明。 */
function Slider({ label, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="appearance__row">
      <span className="appearance__label">{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      <span className="appearance__value">{format(value)}</span>
    </label>
  );
}
