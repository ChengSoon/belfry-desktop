import { useBackground } from "../BackgroundProvider";
import { BACKGROUND_FITS, MAX_BLUR, type BackgroundFit } from "../contracts";
import "./appearance.css";

const FIT_LABEL: Record<BackgroundFit, string> = {
  cover: "覆盖",
  contain: "适应",
  tile: "平铺",
  center: "居中",
};

/**
 * 外观分区。目前只有背景图，名字仍叫「外观」——字号、字体这类后面要加的都归这儿。
 */
export function AppearanceSection() {
  const { config, url, busy, error, update, pick, clear } = useBackground();

  return (
    <>
      <div className="appearance__field">
        <span className="appearance__label">背景图</span>
        {/* 预览直接读 Provider 写在根节点上的那几个 CSS 变量，和舞台是同一套值，
            所以这里看到的压制强度、模糊和填充方式就是终端上的真实效果。
            设置面板会挡住终端，没有这块预览就只能靠盲调。 */}
        <div className="appearance__preview">
          {url ? (
            <>
              <div className="appearance__preview-image" />
              <div className="appearance__preview-scrim" />
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

      {config.fileName ? (
        <>
          <Slider
            format={(value) => `${Math.round(value * 100)}%`}
            label="不透明度"
            max={1}
            min={0}
            onChange={(opacity) => update({ opacity })}
            step={0.01}
            value={config.opacity}
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
      ) : null}
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
