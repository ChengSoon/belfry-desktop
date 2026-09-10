export function installPanelBridge(revive, { installFiles, installChrome, chromeStyle, readHistory, historySteps, selectionContents, selectionReader, installBrowser, installAppearance, readRange, rangeSteps }) {
  const base = new URL(document.currentScript.src).href.replace(/__bridge\.js$/, "");
  const listeners = new Map();
  let browserUpdate;
  function decode(api, source) {
    const result = JSON.parse(source);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return revive(api, result.value);
  }
  async function request(api, payload = {}) {
    browserUpdate?.(api, payload);
    const response = await fetch(base + "__invoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api, payload }) });
    return decode(api, await response.text());
  }
  function invoke(api, payload) {
    if (api === "clipboard.getHistory") return readHistory((name, args) => request(name, args[0]), historySteps);
    if (api === "fs.readRange") return readRange((input) => request(api, input), payload, rangeSteps);
    return request(api, payload);
  }
  function synchronous(api, payload = {}) {
    const request = new XMLHttpRequest();
    request.open("POST", base + "__invoke", false);
    request.setRequestHeader("Content-Type", "application/json"); request.send(JSON.stringify({ api, payload }));
    return decode(api, request.responseText);
  }
  const send = createSynchronousSender(synchronous, { historySteps, rangeSteps });
  function on(name, handler) {
    const set = listeners.get(name) ?? new Set(); set.add(handler); listeners.set(name, set);
    return () => { set.delete(handler); if (!set.size) listeners.delete(name); };
  }
  const bridge = { invoke, send, on };
  browserUpdate = installBrowser(bridge);
  installAppearance(bridge);
  const contents = selectionContents(bridge);
  selectionReader(contents);
  const getDroppedFilePath = installFiles(bridge, contents);
  Object.defineProperty(window, "pluginBridge", { value: Object.freeze({ ...bridge, getDroppedFilePath }) });
  const search = new URLSearchParams(location.search);
  const surfaceId = search.get("piSurface") === "view" ? `view:${search.get("piViewId")}` : "panel";
  const events = new EventSource(base + "__events?surfaceId=" + encodeURIComponent(surfaceId));
  events.onmessage = (event) => {
    const { name, args } = JSON.parse(event.data);
    for (const handler of listeners.get(name) ?? []) { try { handler(...args); } catch (error) { console.error(error); } }
  };
  window.addEventListener("pagehide", () => events.close(), { once: true });
  installChrome(bridge, chromeStyle);
}

export function createSynchronousSender(synchronous, { historySteps, rangeSteps }) {
  return (api, payload) => {
    if (api === "fs.readRange") {
      const iterator = rangeSteps(payload); let current = iterator.next();
      while (!current.done) current = iterator.next(synchronous(api, current.value));
      return current.value;
    }
    if (api !== "clipboard.getHistory") return synchronous(api, payload);
    const iterator = historySteps(); let current = iterator.next();
    while (!current.done) {
      let value;
      try { value = synchronous(current.value[0], current.value[1][0]); }
      catch (error) { current = iterator.throw(error); continue; }
      current = iterator.next(value);
    }
    return current.value;
  };
}
