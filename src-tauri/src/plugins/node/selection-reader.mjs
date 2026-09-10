export function installSelectionReader(contents) {
  if (typeof FileReader === "undefined") return;
  const states = new WeakMap(), proto = FileReader.prototype;
  const nativeAbort = proto.abort;
  const nativeGetters = Object.fromEntries(["readyState", "result", "error"].map((key) => [key, Object.getOwnPropertyDescriptor(proto, key).get]));
  for (const key of Object.keys(nativeGetters)) Object.defineProperty(proto, key, { configurable: true,
    get() { return states.has(this) ? states.get(this)[key] : nativeGetters[key].call(this); } });
  const event = (reader, type, state) => reader.dispatchEvent(new ProgressEvent(type, { lengthComputable: true, loaded: state.loaded, total: state.total }));
  const active = (reader, state) => states.get(reader) === state && state.readyState === FileReader.LOADING;
  function start(reader, file, { method, encoding }) {
    if (reader.readyState === FileReader.LOADING) throw new DOMException("文件正在读取", "InvalidStateError");
    const state = { readyState: FileReader.LOADING, result: null, error: null, loaded: 0, total: file.size, abort: new AbortController() };
    states.set(reader, state);
    queueMicrotask(() => readSelectedFile({ contents, decode, event, active, finish }, reader, { file, state, method, encoding }));
  }
  function finish(reader, state, type) {
    state.readyState = FileReader.DONE; event(reader, type, state);
    if (states.get(reader) === state && reader.readyState !== FileReader.LOADING) event(reader, "loadend", state);
  }
  const methods = ["readAsArrayBuffer", "readAsText", "readAsDataURL", "readAsBinaryString"];
  const originals = Object.fromEntries(methods.filter((method) => proto[method]).map((method) => [method, proto[method]]));
  function decode(blob, method, encoding) {
    return new Promise((resolve, reject) => {
      const native = new FileReader(); native.onload = () => resolve(native.result); native.onerror = () => reject(native.error);
      originals[method].call(native, blob, encoding);
    });
  }
  for (const method of Object.keys(originals)) proto[method] = function (blob, encoding) {
    if (contents.isSelected(blob)) return start(this, blob, { method, encoding });
    if (this.readyState === FileReader.LOADING) throw new DOMException("文件正在读取", "InvalidStateError");
    states.delete(this); return originals[method].call(this, blob, encoding);
  };
  proto.abort = function () {
    const state = states.get(this);
    if (!state) return nativeAbort.call(this);
    state.result = null;
    if (state.readyState !== FileReader.LOADING) return;
    state.abort.abort(); finish(this, state, "abort");
  };
}

export async function readSelectedFile({ contents, decode, event, active, finish }, reader, { file, state, method, encoding }) {
  if (!active(reader, state)) return;
  event(reader, "loadstart", state);
  try {
    const bytes = await contents.collect(file, { signal: state.abort.signal, progress: (loaded) => {
      if (active(reader, state)) { state.loaded = loaded; event(reader, "progress", state); }
    } });
    const result = await decode(bytes, method, encoding);
    if (!active(reader, state)) return;
    state.result = result; finish(reader, state, "load");
  } catch (error) {
    if (!active(reader, state)) return;
    state.error = error instanceof DOMException ? error : new DOMException(String(error.message), "NotReadableError");
    finish(reader, state, "error");
  }
}
