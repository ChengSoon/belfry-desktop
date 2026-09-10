export function pluginNotice(message: string) {
  window.dispatchEvent(new CustomEvent("plugin-local-notice", { detail: message }));
}
