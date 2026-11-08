import { Component, type ReactNode, type RefObject } from "react";

interface Props {
  container: RefObject<HTMLDivElement | null>;
  pinned: RefObject<boolean>;
  onRestore: (top: number) => void;
  children: ReactNode;
}
interface Anchor { key: string; offset: number }

/** Capture immediately before DOM changes, even if the reader scrolls during IPC. */
export class TimelineAnchor extends Component<Props, object, Anchor | null> {
  getSnapshotBeforeUpdate(): Anchor | null {
    const node = this.props.container.current;
    if (!node || this.props.pinned.current || !node.clientHeight) return null;
    const top = node.getBoundingClientRect().top;
    const row = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")].find(row => row.getBoundingClientRect().bottom > top);
    return row ? { key: row.dataset.timelineKey!, offset: row.getBoundingClientRect().top - top } : null;
  }
  componentDidUpdate(_previous: Props, _state: object, anchor: Anchor | null) {
    const node = this.props.container.current;
    if (!anchor || !node || this.props.pinned.current) return;
    const row = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")].find(row => row.dataset.timelineKey === anchor.key);
    if (!row) return;
    node.scrollTop += row.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.offset;
    this.props.onRestore(node.scrollTop);
  }
  render() { return this.props.children; }
}
