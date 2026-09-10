import { apiError } from "./errors.mjs";
import { reviveApiValue } from "./api-values.mjs";
import { installPanelBridge, createSynchronousSender } from "./panel-client.mjs";
import { installPanelFiles, createFileTransfer } from "./panel-files.mjs";
import { installPanelChrome } from "./panel-chrome.mjs";
import { CHROME_STYLE } from "./panel-chrome-style.mjs";
import { collectClipboardHistory, clipboardHistorySteps } from "./clipboard-client.mjs";
import { installSelectionContents, collectSelectedBlob } from "./selection-contents.mjs";
import { installSelectionReader, readSelectedFile } from "./selection-reader.mjs";
import { installPanelBrowser, bindBrowserInput, browserPasteShortcut } from "./panel-browser.mjs";
import { installPanelAppearance } from "./panel-appearance.mjs";
import { collectRange, rangeSteps } from "./range-reader.mjs";

const HELPERS = { createSynchronousSender, createFileTransfer, collectSelectedBlob, readSelectedFile, bindBrowserInput, browserPasteShortcut };
export const BRIDGE_SOURCE = `(() => {${Object.entries(HELPERS).map(([name, helper]) => `const ${name} = ${helper};`).join("\n")}
(${installPanelBridge})(${reviveApiValue}, {installFiles:${installPanelFiles},installChrome:${installPanelChrome},chromeStyle:${JSON.stringify(CHROME_STYLE)},readHistory:${collectClipboardHistory},historySteps:${clipboardHistorySteps},selectionContents:${installSelectionContents},selectionReader:${installSelectionReader},installBrowser:${installPanelBrowser},installAppearance:${installPanelAppearance},readRange:${collectRange},rangeSteps:${rangeSteps}});})();`;

export function bridgeArguments(api, payload = {}) {
  const empty = ["plugin.getId", "plugin.getManifest", "plugin.getSettings", "app.getVersion", "app.getLocale", "app.getAppearance",
    "workspace.get", "ui.closePanel", "ui.getNotificationPermission", "ui.requestNotificationPermission", "clipboard.readText", "clipboard.getHistory", "fs.requestDirectory", "models.list", "session.getLlmContext"];
  if (empty.includes(api)) return [];
  const full = ["ui.openPanel", "ui.notify", "ui.showNativeNotification", "net.fetch", "agent.complete", "fs.pickFiles", "ui.windowControl",
    "clipboard.historyPage", "clipboard.imageChunk", "clipboard.releaseHistory"];
  if (full.includes(api) || api.startsWith("browser.")) return [payload];
  const converters = {
    "plugin.setSettings": () => [payload.partial ?? payload.values ?? payload],
    "ui.showToast": () => [payload.message, payload.level],
    "clipboard.writeText": () => [payload.text], "shell.openExternal": () => [payload.url],
    "fs.writeText": () => [payload.path, payload.content ?? payload.text],
    "fs.readRange": () => [payload.path, payload.byteOffset ?? payload.offset, payload.length, payload.grantId],
    "fs.readSelection": () => [payload.selectionId, payload.offset, payload.length],
    "fs.stat": () => [payload.path, payload.grantId], "fs.glob": () => [payload.pattern],
  };
  if (Object.hasOwn(converters, api)) return converters[api]();
  if (["fs.registerDropped", "fs.readText", "fs.readPreview", "fs.list", "fs.openDefault", "fs.reveal"].includes(api)) return [payload.path];
  throw apiError("UNSUPPORTED", `面板不可调用 ${api}`);
}
