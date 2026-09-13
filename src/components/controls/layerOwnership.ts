interface Layer { anchor: HTMLElement; panel: HTMLElement }
const layers: Layer[] = [];

/** Portal 仍属于它的触发控件，外层菜单不能把它当成外部点击。 */
export function registerLayer(layer: Layer) {
  layers.push(layer);
  return () => { const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1); };
}

export function isTopLayer(panel: HTMLElement | null) {
  let top = layers.at(-1);
  const visited = new Set<Layer>();
  while (top && !visited.has(top)) {
    visited.add(top);
    const child = [...layers].reverse().find((layer) => layer !== top && !visited.has(layer) && ownsTarget(top!.panel, layer.anchor));
    if (!child) break;
    top = child;
  }
  return !!panel && top?.panel === panel;
}

export function ownsTarget(root: HTMLElement | null, target: Node | null): boolean {
  if (!root || !target) return false;
  const pending: Node[] = [target];
  const visited = new Set<Node>();
  while (pending.length) {
    const node = pending.pop()!;
    if (root.contains(node)) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const layer of layers) if (layer.panel.contains(node)) pending.push(layer.anchor);
  }
  return false;
}

/** WebKit 点击按钮时 relatedTarget 可能为空；外部鼠标点击由 dismiss 监听处理。 */
export function shouldDismissOnBlur(root: HTMLElement | null, target: Node | null) {
  return target !== null && !ownsTarget(root, target);
}

export function focusableControls(root: HTMLElement) {
  const containers = [root, ...layers.filter((layer) => ownsTarget(root, layer.anchor)).map((layer) => layer.panel)];
  const selector = 'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex]';
  return [...new Set(containers.flatMap((node) => [...node.querySelectorAll<HTMLElement>(selector)]))]
    .filter((node) => node.tabIndex >= 0 && !node.closest("[hidden],[inert]") && node.getClientRects().length > 0);
}

export function focusAdjacent(trigger: HTMLElement | null, direction: number) {
  if (!trigger) return;
  const modal = trigger.closest<HTMLElement>('[role="dialog"]');
  const items = focusableControls(modal ?? document.body).filter((node) => !node.closest("[data-control-layer]"));
  const index = items.indexOf(trigger);
  const next = items[index + direction] ?? (modal ? direction > 0 ? items[0] : items.at(-1) : trigger);
  next?.focus();
}
