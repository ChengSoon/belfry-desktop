import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Observe only this isolated production fixture. Do not focus, delay, retry or
// synthesize input; preserve the original recovery test's actions and waits.
export function sessionRecoveryQa(t) {
  let view;
  const protocol = [], errors = [];
  t.after(async () => {
    if (!view) return;
    try {
      const [state, screenshot] = await Promise.all([
        view.cdp.evaluate("__productionQA.recovery.snapshot()"),
        view.send("Page.captureScreenshot", { format: "png" }),
      ]);
      const directory = process.env.BELFRY_PANEL_ARTIFACTS;
      const artifacts = directory ? { json: join(directory, "session-recovery-final.json"), screenshot: join(directory, "session-recovery-final.png") } : null;
      const report = { test: t.name, head: process.env.GITHUB_SHA ?? null, node: process.version,
        platform: process.platform, state, protocol, errors, artifacts };
      if (artifacts) {
        await mkdir(directory, { recursive: true });
        await writeFile(artifacts.json, JSON.stringify(report, null, 2) + "\n");
        await writeFile(artifacts.screenshot, Buffer.from(screenshot.data, "base64"));
      }
      t.diagnostic(JSON.stringify({ recovery: { artifacts, session: state.session, active: state.active,
        inputs: state.inputs, writes: state.writes, creates: state.creates, events: state.timeline.length, errors } }));
    } catch (error) { t.diagnostic(`Recovery evidence capture failed: ${error.message}`); }
  });
  return {
    source: `(${observeRecovery.toString()})()`,
    async beforeNavigate(target) {
      view = target;
      const send = view.send.bind(view);
      view.send = async (method, params) => {
        if (!method.startsWith("Input.")) return send(method, params);
        const at = Date.now();
        protocol.push({ at, stage: "send", method, params });
        try { const result = await send(method, params); protocol.push({ at: Date.now(), stage: "returned", method }); return result; }
        catch (error) { protocol.push({ at: Date.now(), stage: "failed", method, message: error.message }); throw error; }
      };
      const listen = ({ sessionId, method, params }) => {
        if (sessionId === view.sessionId && method === "Runtime.exceptionThrown") errors.push(params.exceptionDetails);
      };
      view.process.on("protocol", listen);
      t.after(() => view.process.off("protocol", listen));
    },
  };
}

function observeRecovery() {
  const qa = window.__productionQA, timeline = [], ids = new WeakMap();
  let nextId = 0;
  const node = element => {
    if (!(element instanceof Element)) return null;
    if (!ids.has(element)) ids.set(element, ++nextId);
    return { id: ids.get(element), tag: element.tagName, className: element.getAttribute("class"),
      connected: element.isConnected, label: element.getAttribute("aria-label") };
  };
  const inspect = element => {
    if (!(element instanceof Element)) return null;
    const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
    return { ...node(element), bounds: bounds.toJSON(), display: style.display, visibility: style.visibility,
      opacity: style.opacity, pointerEvents: style.pointerEvents, value: element.value ?? null,
      centerHit: node(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)) };
  };
  const record = (kind, detail) => {
    timeline.push({ at: performance.now(), kind, session: qa.pty ?? null, generation: qa.creates, ...detail });
    if (timeline.length > 600) timeline.shift();
  };
  const invoke = __TAURI_INTERNALS__.invoke;
  __TAURI_INTERNALS__.invoke = (command, args) => {
    if (!command.startsWith("terminal_")) return invoke(command, args);
    record("native-call", { command, args });
    const result = invoke(command, args);
    result.then(value => record("native-return", { command, value }), error => record("native-error", { command, error: String(error) }));
    return result;
  };
  const emit = qa.emit;
  qa.emit = event => { record("terminal-event", { event }); return emit(event); };
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "focusin", "focusout", "beforeinput", "input", "keydown", "keyup"]) {
    document.addEventListener(type, event => record(type, { target: inspect(event.target), active: node(document.activeElement),
      x: event.clientX, y: event.clientY, key: event.key, data: event.data, inputType: event.inputType }), true);
  }
  new MutationObserver(records => {
    for (const item of records) for (const change of ["addedNodes", "removedNodes"]) {
      for (const element of item[change]) {
        if (!(element instanceof Element)) continue;
        const inputs = [...element.querySelectorAll(".xterm-helper-textarea")];
        if (element.matches(".xterm-helper-textarea")) inputs.unshift(element);
        if (inputs.length) record(change, { inputs: inputs.map(node) });
      }
    }
  }).observe(document, { childList: true, subtree: true });
  qa.recovery = { record, snapshot: () => ({ session: qa.pty, creates: qa.creates,
    active: inspect(document.activeElement), inputs: [...document.querySelectorAll(".xterm-helper-textarea")].map(inspect),
    alerts: [...document.querySelectorAll(".terminal-alert")].map(inspect), writes: qa.writes,
    calls: qa.calls.filter(call => call.command.startsWith("terminal_")), timeline,
    workspace: JSON.parse(localStorage.getItem("belfry.workspace.v1")),
    dom: document.getElementById("root")?.outerHTML, errors: qa.errors }) };
}
