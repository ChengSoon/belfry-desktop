import { Check, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { shouldDismissOnBlur } from "../../components/controls/layerOwnership";
import { maskKey } from "../validate";

interface ProviderCardProps {
  nodeRef?: (node: HTMLElement | null) => void;
  active: boolean;
  busy: boolean;
  label: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  onEdit?: () => void;
  onRemove?: () => void;
  onSelect: () => void;
}

export function ProviderCard(props: ProviderCardProps) {
  const { nodeRef, active, busy, label, endpoint, model, apiKey, onEdit, onRemove, onSelect } = props;
  const cardRef = useCardSwitchMotion(active);
  const setCardRef = (node: HTMLElement | null) => {
    cardRef.current = node;
    nodeRef?.(node);
  };
  return (
    <article ref={setCardRef} className={`provider-card${active ? " is-active" : ""}`} aria-label={label}>
      <div className="provider-card__identity">
        <h4 title={label}>{label}</h4>
        <p className="provider-card__endpoint" title={endpoint}>{endpoint}</p>
      </div>
      <div className="provider-card__model"><span>模型</span><code title={model}>{model}</code></div>
      <div className="provider-card__auth"><span>认证</span><code>{maskKey(apiKey ?? "")}</code></div>
      <div className="provider-card__actions">
        <div className="provider-card__selection" data-active={active}>
          <button className="provider-card__activate" disabled={busy || active} onClick={onSelect}
            type="button" aria-label={active ? undefined : `启用 ${label}`} aria-hidden={active} tabIndex={active ? -1 : 0}>启用</button>
          <span className="provider-card__status" aria-hidden={!active}><Check size={14} aria-hidden="true" />已选用</span>
        </div>
        {onEdit && <button disabled={busy} onClick={onEdit} type="button" aria-label={`编辑 ${label}`}><Pencil size={13} aria-hidden="true" />编辑</button>}
        {onRemove && <details className="provider-card__more" onBlur={(event) => {
          if (shouldDismissOnBlur(event.currentTarget, event.relatedTarget as Node | null)) event.currentTarget.open = false;
        }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary aria-label={`${label} 的更多操作`}><MoreHorizontal size={16} aria-hidden="true" /></summary>
          <button className="provider-card__remove" disabled={busy} onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open"); onRemove();
          }} aria-label={`删除 ${label}`} type="button"><Trash2 size={14} aria-hidden="true" />删除配置</button>
        </details>}
      </div>
    </article>
  );
}

/**
 * 只响应实际选中变化：新选中卡片抬起后真翻过去（转到 90° 侧立时正面投影为零，
 * 在看不见的那一刻完成启用/已选用切换），再从另一侧翻回落定；
 * 原卡片只轻微回落。首次加载、编辑和更多操作都不触发。
 */
function useCardSwitchMotion(active: boolean) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current === active) return;
    previous.current = active;
    const card = ref.current;
    if (!card?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rest = "perspective(900px) translateY(0) rotateY(0deg) scale(1)";
    if (!active) {
      const settle = card.animate(
        [
          { transform: rest },
          { transform: "perspective(900px) translateY(4px) rotateY(6deg) scale(0.99)" },
          { transform: rest },
        ],
        { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
      return () => settle.cancel();
    }
    const half = 260;
    const edge = (over: number): Keyframe => ({
      transform: `perspective(900px) translateY(-12px) rotateY(${over}deg) scale(1.02)`,
    });
    const rise = card.animate(
      [{ transform: rest }, edge(90)],
      { duration: half, easing: "cubic-bezier(0.32, 0.72, 0.35, 1)", fill: "forwards" },
    );
    const fall = card.animate(
      [edge(-90), { transform: rest }],
      { duration: half, delay: half, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
    );
    return () => { rise.cancel(); fall.cancel(); };
  }, [active]);
  return ref;
}
