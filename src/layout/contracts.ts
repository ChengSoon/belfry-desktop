export type SplitDirection = "row" | "column";

/** 拖拽落点：四条边生成分屏，中心是"换成这个会话"。 */
export type DropEdge = "left" | "right" | "top" | "bottom" | "center";

/**
 * 分屏是一棵二叉树，叶子承载会话 id。
 * 树只描述"谁挨着谁、各占多少"，具体像素由 computeFrames 折算成百分比矩形——
 * 终端组件在 React 树里的位置必须恒定（一重挂就杀 PTY），所以布局只能改坐标。
 */
export type LayoutNode =
  | { kind: "leaf"; tabId: string }
  | {
      kind: "split";
      direction: SplitDirection;
      /** first 占父容器的比例，second 拿剩下的。 */
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

/** 百分比矩形，0-100，直接喂给 CSS 的 left/top/width/height。 */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PaneFrame {
  tabId: string;
  rect: Rect;
}

export interface DividerFrame {
  /** 定位到某个 split 节点：根是 ""，走 first 追加 "0"，走 second 追加 "1"。 */
  path: string;
  direction: SplitDirection;
  /** 竖分隔条 width 恒为 0、横的 height 恒为 0，实际厚度由 CSS 给。 */
  rect: Rect;
  /** 该 split 在分割方向上占满屏的百分比，拖拽时用来把像素位移折成 ratio。 */
  span: number;
  /** 所属 split 当前的 ratio，拖拽的起点就是它。 */
  ratio: number;
}

export interface LayoutFrame {
  panes: PaneFrame[];
  dividers: DividerFrame[];
}

export interface DropTarget {
  tabId: string;
  edge: DropEdge;
}
