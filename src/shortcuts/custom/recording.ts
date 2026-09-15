export function isShortcutRecording() {
  return typeof document !== "undefined" && Boolean(document.querySelector("[data-shortcut-recorder='true']"));
}
