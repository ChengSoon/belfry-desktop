import { lstat, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { apiError } from "./errors.mjs";

const MAX_FILES = 128, MAX_ACCEPT_LENGTH = 2048;

// 用户在浏览器网页的文件输入中选择文件，仅授权该输入；不授予插件 fs 访问权。
export class BrowserFileChooser {
  constructor(target, { pickFiles, active = () => true, reportError = () => {} }) {
    this.target = target; this.pickFiles = pickFiles; this.active = active; this.reportError = reportError;
    this.documents = new Map(); this.pending = false;
  }
  async initialize() {
    if (this.pickFiles) await this.target.send("Page.setInterceptFileChooserDialog", { enabled: true });
  }
  available() { return !this.target.closed && this.active(); }
  event(method, params) {
    if (method === "Page.frameNavigated") {
      const frameId = params.frame?.id;
      this.documents.set(frameId, (this.documents.get(frameId) ?? 0) + 1);
    }
    if (method === "Page.fileChooserOpened" && this.pickFiles) void this.choose(params);
  }
  async choose({ backendNodeId, frameId, mode }) {
    if (this.pending || !this.available()) return;
    const document = this.documents.get(frameId) ?? 0;
    const current = () => this.available() && document === (this.documents.get(frameId) ?? 0);
    this.pending = true;
    try {
      const options = await inputOptions(this.target, backendNodeId, mode);
      if (!current()) return;
      const selected = await this.pickFiles(options);
      if (!current()) return;
      const files = await selectedFiles(selected, options);
      if (!current()) return;
      if (!files.length) await cancelSelection(this.target, backendNodeId);
      else await this.target.send("DOM.setFileInputFiles", { backendNodeId, files });
    } catch (error) {
      if (current()) this.reportError(error);
    } finally { this.pending = false; }
  }
}

async function inputOptions(target, backendNodeId, mode) {
  if (!Number.isInteger(backendNodeId)) throw apiError("BROWSER_ERROR", "浏览器文件输入已失效");
  const { node } = await target.send("DOM.describeNode", { backendNodeId });
  const pairs = node?.attributes ?? [], attributes = new Map();
  for (let index = 0; index < pairs.length; index += 2) attributes.set(pairs[index], pairs[index + 1]);
  if (node?.nodeName !== "INPUT" || attributes.get("type")?.toLowerCase() !== "file") throw apiError("BROWSER_ERROR", "浏览器文件输入已失效");
  return { multiple: mode === "selectMultiple", accept: (attributes.get("accept") ?? "").slice(0, MAX_ACCEPT_LENGTH),
    ...(attributes.has("webkitdirectory") ? { directory: true } : {}) };
}

async function selectedFiles(paths, { multiple, directory }) {
  if (!Array.isArray(paths) || paths.length > MAX_FILES) throw apiError("INVALID_ARGUMENT", "所选文件数量无效");
  const files = [];
  for (const path of multiple && !directory ? paths : paths.slice(0, 1)) {
    files.push(await selectedPath(path, directory));
  }
  return files;
}
async function selectedPath(path, directory) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) throw apiError("INVALID_ARGUMENT", "所选文件路径无效");
  const metadata = await lstat(path);
  if (!(directory ? metadata.isDirectory() : metadata.isFile())) throw apiError("INVALID_ARGUMENT", "所选文件类型无效");
  return realpath(path);
}

async function cancelSelection(target, backendNodeId) {
  const { object } = await target.send("DOM.resolveNode", { backendNodeId });
  if (!object?.objectId) return;
  try {
    await target.send("Runtime.callFunctionOn", { objectId: object.objectId,
      functionDeclaration: "function(){this.dispatchEvent(new Event('cancel',{bubbles:true}));}" });
  } finally { await target.send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => {}); }
}
