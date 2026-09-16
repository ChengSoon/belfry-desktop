/**
 * 卡片销毁碎裂效果：把目标节点整张克隆，按网格切成碎片向外炸开、翻滚下坠。
 *
 * 每片是完整克隆 + clip-path 切出自己那一格，这样文字/背景在碎片里仍是连续的。
 * 只用 Web Animations API，不引入依赖；碎片挂在临时容器里，
 * 动画结束（或 prefers-reduced-motion / 动画不可用）时整体移除。
 */

interface Shard {
  el: HTMLElement;
  x: number;
  y: number;
  rotate: number;
  delay: number;
}

const GRID = 5;
const PIECES = GRID * GRID;
const DURATION = 1050;
const GRAVITY = 330;

/** 返回碎裂句柄；cancel 可在删除失败时立刻复原。 */
export function shatterCard(target: HTMLElement): { cancel: () => void } {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !target.animate) return { cancel: () => {} };

  const host = document.createElement("div");
  host.className = "shatter-host";
  document.body.appendChild(host);

  const rect = target.getBoundingClientRect();
  const cellW = rect.width / GRID;
  const cellH = rect.height / GRID;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const shards: Shard[] = [];
  for (let index = 0; index < PIECES; index += 1) {
    const col = index % GRID;
    const row = Math.floor(index / GRID);
    const el = target.cloneNode(true) as HTMLElement;
    el.removeAttribute("id");
    el.classList.add("shatter-piece");
    // 整张克隆铺在原位，只用 clip-path 露出自己那一格，碎片里的内容仍对得上。
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.clipPath = `inset(${row * cellH}px ${(GRID - 1 - col) * cellW}px ${(GRID - 1 - row) * cellH}px ${col * cellW}px`;
    host.appendChild(el);

    // 从中心向外的方向加随机扰动，模拟破裂的不规则感。
    const angle = Math.atan2(rect.top + (row + 0.5) * cellH - cy, rect.left + (col + 0.5) * cellW - cx);
    const power = 60 + Math.random() * 120;
    const drift = (Math.random() - 0.5) * 0.7;
    shards.push({
      el,
      x: Math.cos(angle + drift) * power,
      y: Math.sin(angle + drift) * power * 0.5 - 30 - Math.random() * 70,
      rotate: (Math.random() - 0.5) * 240,
      delay: Math.random() * 90,
    });
  }

  // 碎裂期间原卡片隐藏，避免重影；失败时 cancel 会复原。
  target.style.visibility = "hidden";

  const animations = shards.map(({ el, x, y, rotate, delay }) =>
    el.animate(
      [
        { transform: "translate3d(0,0,0) rotate(0deg)", opacity: 1, offset: 0 },
        { transform: `translate3d(${x * 0.5}px, ${y * 0.55}px, 0) rotate(${rotate * 0.35}deg)`, opacity: 1, offset: 0.38 },
        { transform: `translate3d(${x}px, ${y + GRAVITY}px, 0) rotate(${rotate}deg)`, opacity: 0, offset: 1 },
      ],
      { duration: DURATION, delay, easing: "cubic-bezier(0.3, 0.75, 0.4, 1)", fill: "forwards" },
    ),
  );

  const cleanup = () => {
    animations.forEach((item) => item.cancel());
    host.remove();
    target.style.visibility = "";
  };
  Promise.all(animations.map((item) => item.finished.catch(() => undefined))).then(cleanup, cleanup);

  return { cancel: cleanup };
}
