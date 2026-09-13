/** 只滚动消息面板，scrollIntoView 会同时移动 overflow:hidden 的整个工作台。 */
export function focusMessageInPanel(entry: HTMLElement) {
  const panel = entry.closest<HTMLElement>(".history-detail__body");
  if (!panel) return;
  const relativeTop = entry.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
  const inset = Math.max(0, (panel.clientHeight - entry.clientHeight) / 2);
  panel.scrollTo({ top: Math.max(0, relativeTop - inset) });
  entry.focus({ preventScroll: true });
}
