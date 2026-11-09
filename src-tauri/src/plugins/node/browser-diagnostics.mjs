import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIRST_EVENTS = 64, LAST_EVENTS = 96, STDERR_BYTES = 16 * 1024, STDERR_LINES = 24, LINE_CHARS = 2048;
// Only protocol names involved in initialization/lifetime are retained. No command
// parameters, results, expressions, URLs, titles, paths or stderr bodies are logged.
const METHODS = new Set(["Browser.getVersion", "Target.createBrowserContext", "Target.createTarget", "Target.attachToTarget",
  "Target.disposeBrowserContext", "Runtime.enable", "Page.enable", "DOM.enable", "Accessibility.enable", "Console.enable",
  "Page.setInterceptFileChooserDialog", "Emulation.setDeviceMetricsOverride", "Emulation.setFocusEmulationEnabled",
  "Runtime.addBinding", "Page.addScriptToEvaluateOnNewDocument"]);
const EVENTS = new Set(["Target.attachedToTarget", "Target.detachedFromTarget", "Target.targetDestroyed", "Target.targetCrashed",
  "Inspector.detached", "Inspector.targetCrashed", "Runtime.executionContextsCleared", "Runtime.executionContextCreated"]);
const CODES = new Set(["BROWSER_CLOSED", "BROWSER_ERROR", "TIMEOUT", "LIMIT_EXCEEDED", "BUSY", "INVALID_ARGUMENT", "UNAVAILABLE",
  "EACCES", "EBADF", "EBUSY", "ECONNRESET", "EEXIST", "EINVAL", "EIO", "ENOENT", "ENOSPC", "ENOTDIR", "EPERM", "EPIPE",
  "ERR_STREAM_DESTROYED", "ERR_STREAM_PREMATURE_CLOSE", "ERR_INVALID_ARG_TYPE"]);
export function diagnosticError(error) {
  return { code: CODES.has(error?.code) ? error.code : "UNKNOWN",
    ...(Number.isInteger(error?.errno) ? { errno: error.errno } : {}) };
}

function stderrSummary(line) {
  const severity = line.match(/:(INFO|WARNING|ERROR|FATAL|VERBOSE[0-9]?):/)?.[1] ?? "unknown";
  // Classify known Chromium subsystems instead of copying source filenames or
  // free text, either of which could contain page/extension-controlled content.
  const header = line.match(/^\[[^\]\n]{1,240}\]/)?.[0] ?? "";
  const component = ["gpu", "sandbox", "headless", "renderer", "devtools", "network", "crashpad"]
    .find((name) => header.toLowerCase().includes(name)) ?? "other";
  const category = /out of memory|oom-kill/i.test(line) ? "out-of-memory"
    : /received signal|segmentation fault/i.test(line) ? "signal"
    : /remote.debugging.pipe/i.test(line) ? "debugging-pipe" : "redacted";
  return { severity, component, category };
}

export class BrowserDiagnostics {
  constructor(requestTimeoutMs) {
    this.started = performance.now(); this.id = randomUUID(); this.first = []; this.last = []; this.dropped = 0;
    this.requestTimeoutMs = requestTimeoutMs;
    this.stderrBytes = 0; this.inspectedBytes = 0; this.stderrLines = 0; this.stderrRecords = []; this.stderrBuffer = "";
    this.directory = process.env.BELFRY_PANEL_ARTIFACTS;
    this.artifact = join("browser-startup", `${process.pid}-${this.id}.json`);
  }
  now() { return Math.round((performance.now() - this.started) * 1000) / 1000; }
  record(event, data = {}) {
    const entry = { ms: this.now(), event, ...data };
    if (this.first.length < FIRST_EVENTS) this.first.push(entry);
    else { this.last.push(entry); if (this.last.length > LAST_EVENTS) { this.last.shift(); this.dropped++; } }
    return entry;
  }
  identity(value) {
    return typeof value === "string" && value ? createHash("sha256").update(this.id).update(value).digest("hex").slice(0, 12) : null;
  }
  ids(value = {}) {
    value ??= {};
    return Object.fromEntries(["browserContextId", "targetId", "sessionId"]
      .filter((key) => typeof value[key] === "string").map((key) => [key, this.identity(value[key])]));
  }
  request(id, method, sessionId) { return { id, method: METHODS.has(method) ? method : "other", sessionId: this.identity(sessionId) }; }
  protocol(message) {
    if (!EVENTS.has(message.method)) return;
    const params = message.params ?? {};
    this.record("protocol.event", { method: message.method, ...this.ids({ browserContextId: params.browserContextId, sessionId: message.sessionId ?? params.sessionId,
      targetId: params.targetId ?? params.targetInfo?.targetId }) });
  }
  stderr(bytes) {
    this.stderrBytes += bytes.length;
    const length = Math.min(bytes.length, STDERR_BYTES - this.inspectedBytes);
    if (length <= 0) return;
    this.inspectedBytes += length;
    const lines = (this.stderrBuffer + bytes.subarray(0, length).toString("utf8")).split(/\r?\n/);
    this.stderrBuffer = lines.pop().slice(0, LINE_CHARS);
    for (const line of lines) this.stderrLine(line.slice(0, LINE_CHARS));
    if (this.inspectedBytes === STDERR_BYTES) this.finishStderr();
  }
  stderrLine(line) {
    if (!line) return;
    this.stderrLines++;
    if (this.stderrRecords.length < STDERR_LINES) this.stderrRecords.push({ ms: this.now(), ...stderrSummary(line) });
  }
  finishStderr() { this.stderrLine(this.stderrBuffer); this.stderrBuffer = ""; }
  snapshot(state) {
    return { schemaVersion: 1, id: this.id, elapsedMs: this.now(), requestTimeoutMs: this.requestTimeoutMs,
      firstFailure: this.firstFailure, state, events: [...this.first, ...this.last], droppedEvents: this.dropped,
      stderr: { bytes: this.stderrBytes, inspectedBytes: this.inspectedBytes, omittedBytes: this.stderrBytes - this.inspectedBytes,
        inspectedLines: this.stderrLines, omittedInspectedLines: Math.max(0, this.stderrLines - this.stderrRecords.length),
        records: [...this.stderrRecords], body: "omitted" },
      ...(this.directory ? { artifact: this.artifact } : {}), ...(this.writeError ? { artifactError: this.writeError } : {}) };
  }
  persist(snapshot) {
    if (!this.directory || !this.firstFailure) return;
    try {
      mkdirSync(join(this.directory, "browser-startup"), { recursive: true, mode: 0o700 });
      writeFileSync(join(this.directory, this.artifact), JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
    } catch (error) { this.writeError = diagnosticError(error); } // Never replace the original browser failure.
  }
}
