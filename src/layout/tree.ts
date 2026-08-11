import type { DropEdge, DividerFrame, LayoutFrame, LayoutNode, PaneFrame, Rect } from "./contracts";

/**
 * 单个窗格最少占父容器的比例。给得比"能显示几列字"宽松些：
 * 真正的下限由 terminalController 的 MIN_HOST_WIDTH 兜底，这里只防止拖出个零宽窗格。
 */
export const MIN_RATIO = 0.12;

export function leaf(tabId: string): LayoutNode {
  return { kind: "leaf", tabId };
}

export function clampRatio(ratio: number) {
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio));
}

export function layoutTabIds(node: LayoutNode): string[] {
  if (node.kind === "leaf") return [node.tabId];
  return [...layoutTabIds(node.first), ...layoutTabIds(node.second)];
}

export function hasTab(node: LayoutNode, tabId: string) {
  return layoutTabIds(node).includes(tabId);
}

/** 把某个叶子换成另一个会话；tabId 不在树里就原样返回。 */
export function replaceLeaf(node: LayoutNode, tabId: string, nextTabId: string): LayoutNode {
  if (node.kind === "leaf") return node.tabId === tabId ? leaf(nextTabId) : node;
  const first = replaceLeaf(node.first, tabId, nextTabId);
  const second = replaceLeaf(node.second, tabId, nextTabId);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

/**
 * 在 targetTabId 所在窗格的某条边上劈出新窗格。
 * tabId 已经在树里（窗格之间对拖）时先摘走，否则会出现两个同名叶子。
 */
export function splitLeaf(
  node: LayoutNode,
  targetTabId: string,
  tabId: string,
  edge: DropEdge,
): LayoutNode {
  if (tabId === targetTabId) return node;
  if (edge === "center") {
    // 中心 = 拿这个会话顶掉目标窗格。源窗格摘掉后目标可能被塌缩掉，先确认它还在。
    const pruned = removeLeaf(node, tabId);
    if (!pruned) return leaf(tabId);
    return hasTab(pruned, targetTabId) ? replaceLeaf(pruned, targetTabId, tabId) : pruned;
  }
  const pruned = removeLeaf(node, tabId) ?? leaf(targetTabId);
  if (!hasTab(pruned, targetTabId)) return pruned;
  const direction = edge === "left" || edge === "right" ? "row" : "column";
  const before = edge === "left" || edge === "top";
  return expandLeaf(pruned, targetTabId, (target) => ({
    kind: "split",
    direction,
    ratio: 0.5,
    first: before ? leaf(tabId) : target,
    second: before ? target : leaf(tabId),
  }));
}

/** 摘掉一个叶子，它的父节点塌缩成兄弟；整棵树只剩这一个叶子时返回 null。 */
export function removeLeaf(node: LayoutNode, tabId: string): LayoutNode | null {
  if (node.kind === "leaf") return node.tabId === tabId ? null : node;
  const first = removeLeaf(node.first, tabId);
  if (!first) return node.second;
  const second = removeLeaf(node.second, tabId);
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

/** 会话被关掉后把它从分屏里剔干净；一个都不剩返回 null。 */
export function pruneLayout(node: LayoutNode, alive: ReadonlySet<string>): LayoutNode | null {
  if (node.kind === "leaf") return alive.has(node.tabId) ? node : null;
  const first = pruneLayout(node.first, alive);
  const second = pruneLayout(node.second, alive);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function setRatio(node: LayoutNode, path: string, ratio: number): LayoutNode {
  if (node.kind === "leaf") return node;
  if (path === "") return { ...node, ratio: clampRatio(ratio) };
  const [step, ...rest] = path;
  const branch = step === "0" ? "first" : "second";
  const child = setRatio(node[branch], rest.join(""), ratio);
  return child === node[branch] ? node : { ...node, [branch]: child };
}

export function ratioAt(node: LayoutNode, path: string): number | null {
  if (node.kind === "leaf") return null;
  if (path === "") return node.ratio;
  const [step, ...rest] = path;
  return ratioAt(step === "0" ? node.first : node.second, rest.join(""));
}

/** 把树摊成百分比矩形。窗格按树的中序排列，分隔条落在每个 split 的分界线上。 */
export function computeFrames(node: LayoutNode): LayoutFrame {
  const panes: PaneFrame[] = [];
  const dividers: DividerFrame[] = [];
  walk(node, "", { left: 0, top: 0, width: 100, height: 100 });
  return { panes, dividers };

  function walk(current: LayoutNode, path: string, rect: Rect) {
    if (current.kind === "leaf") {
      panes.push({ tabId: current.tabId, rect });
      return;
    }
    if (current.direction === "row") {
      const head = rect.width * current.ratio;
      walk(current.first, `${path}0`, { ...rect, width: head });
      walk(current.second, `${path}1`, { ...rect, left: rect.left + head, width: rect.width - head });
      dividers.push({
        path,
        direction: "row",
        rect: { left: rect.left + head, top: rect.top, width: 0, height: rect.height },
        span: rect.width,
        ratio: current.ratio,
      });
      return;
    }
    const head = rect.height * current.ratio;
    walk(current.first, `${path}0`, { ...rect, height: head });
    walk(current.second, `${path}1`, { ...rect, top: rect.top + head, height: rect.height - head });
    dividers.push({
      path,
      direction: "column",
      rect: { left: rect.left, top: rect.top + head, width: rect.width, height: 0 },
      span: rect.height,
      ratio: current.ratio,
    });
  }
}

function expandLeaf(
  node: LayoutNode,
  tabId: string,
  expand: (target: LayoutNode) => LayoutNode,
): LayoutNode {
  if (node.kind === "leaf") return node.tabId === tabId ? expand(node) : node;
  const first = expandLeaf(node.first, tabId, expand);
  const second = expandLeaf(node.second, tabId, expand);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}
