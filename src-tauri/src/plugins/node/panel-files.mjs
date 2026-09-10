export function installPanelFiles(bridge, contents) {
  const { paths, byKey, key, transfer } = createFileTransfer(contents);
  let picking = false;
  bridge.on("__host:drop", (files, point) => {
    void transfer(files).then((dataTransfer) => {
      const target = point ? document.elementFromPoint(point.x, point.y) ?? document : document;
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    }).catch((error) => bridge.invoke("ui.showToast", { message: String(error.message), level: "error" }));
  });
  async function choose(input) {
    if (picking) return;
    picking = true;
    try {
      const files = await bridge.invoke("fs.pickFiles", { accept: input.accept, multiple: input.multiple });
      if (!files.length) { input.dispatchEvent(new Event("cancel", { bubbles: true })); return; }
      input.files = (await transfer(files)).files;
      for (const file of input.files) {
        const record = byKey.get(key(file)); paths.set(file, record.path); contents.attach(file, record);
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (error) { console.error(error); void bridge.invoke("ui.showToast", { message: String(error.message), level: "error" }); }
    finally { picking = false; }
  }
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.type !== "file") return;
    event.preventDefault(); void choose(event.target);
  }, true);
  const nativeClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === "file" && !this.disabled) { void choose(this); return; }
    return nativeClick.call(this);
  };
  return (file) => file instanceof File ? paths.get(file) ?? byKey.get(key(file))?.path ?? null : null;
}

export function createFileTransfer(contents) {
  const paths = new WeakMap(), byKey = new Map();
  let stamp = Date.now();
  const nativeModified = Object.getOwnPropertyDescriptor(File.prototype, "lastModified").get;
  const key = (file) => `${file.name}:${nativeModified.call(file)}`;
  async function transfer(files) {
    const data = new DataTransfer();
    let budget = 16 * 1024 * 1024;
    for (const file of files) {
      const options = { lastModified: ++stamp, type: file.type };
      let virtual = new File([], file.name, options);
      if (file.size <= Math.min(4 * 1024 * 1024, budget)) {
        const bytes = await contents.collect(contents.attach(virtual, file));
        virtual = new File([bytes], file.name, options); budget -= file.size;
      }
      byKey.set(key(virtual), file); data.items.add(virtual);
    }
    for (const virtual of data.files) {
      const file = byKey.get(key(virtual));
      paths.set(virtual, file.path);
      contents.attach(virtual, file);
    }
    while (byKey.size > 256) byKey.delete(byKey.keys().next().value);
    return data;
  }
  return { paths, byKey, key, transfer };
}
