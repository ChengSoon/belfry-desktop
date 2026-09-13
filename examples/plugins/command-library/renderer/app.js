import { $, each, notify, renderEditor, renderState } from "./view.js";

const state = { snapshot: null, current: null, baseline: "null", dirty: false, busy: false, locked: false,
  query: "", filter: "all", archived: false, preview: null };
const call = (channel, payload) => window.pluginBridge.invoke(channel, payload);
const context = () => ({ projectKey: state.snapshot.projectKey, revision: state.snapshot.revision });
const draw = () => renderState(state, select);
const invalidate = () => { state.preview = null; $("preview-section").hidden = true; };

function select(entry) {
  if (state.dirty || state.busy) return;
  state.current = entry ? { ...entry } : null; state.baseline = JSON.stringify(state.current); invalidate(); renderEditor(state); draw();
}
function edit(patch) {
  state.current = { ...state.current, ...patch }; state.dirty = JSON.stringify(state.current) !== state.baseline;
  invalidate(); notify(); draw();
}
async function action(work) {
  if (state.busy) return;
  state.busy = true; notify(); draw();
  try { await work(); } catch (error) { notify(error.message ?? String(error), true); }
  finally { state.busy = false; draw(); }
}
async function reload() {
  await action(async () => {
    const selected = state.current?.id; state.snapshot = await call("library.list"); state.locked = false; state.dirty = false;
    state.current = state.snapshot.entries.find((entry) => entry.id === selected) ?? null;
    state.baseline = JSON.stringify(state.current); invalidate(); renderEditor(state);
  });
}
function create() {
  if (state.dirty || state.busy) return;
  state.current = { title: "", category: "", body: "", kind: "prompt", scope: state.snapshot.workspace ? "project" : "global", archived: false };
  state.baseline = "null"; state.dirty = true; invalidate(); notify(); renderEditor(state); draw(); $("title").focus();
}
async function save(entry = state.current) {
  await action(async () => {
    const id = entry.id; state.snapshot = await call("library.save", { ...context(), entry });
    state.current = (id ? state.snapshot.entries.find((item) => item.id === id) : state.snapshot.entries[0]) ?? null;
    state.baseline = JSON.stringify(state.current); state.dirty = false; invalidate(); renderEditor(state); notify("收藏已保存");
  });
}
async function preview() {
  await action(async () => {
    state.preview = await call("library.preview", { ...context(), entry: { ...state.current, title: state.current.title || "未命名" } });
    $("preview-text").value = state.preview.text; $("preview-section").hidden = false;
    $("preview-text").focus({ preventScroll: true }); $("preview-section").scrollIntoView({ block: "nearest" });
  });
}
async function cancelEdit() {
  state.dirty = false;
  if (state.locked) { await reload(); return; }
  const saved = state.snapshot.entries.find((entry) => entry.id === state.current?.id) ?? null;
  select(saved); notify();
}
function insertVariable(key) {
  const input = $("body"), start = input.selectionStart, end = input.selectionEnd;
  const variable = `{{${key}}}`, body = input.value.slice(0, start) + variable + input.value.slice(end);
  if (body.length > input.maxLength) { notify("正文已达到长度上限", true); return; }
  edit({ body }); input.value = body; input.focus(); input.setSelectionRange(start + variable.length, start + variable.length);
}

$("new").addEventListener("click", create); $("refresh").addEventListener("click", reload);
$("search").addEventListener("input", (event) => { state.query = event.target.value; draw(); });
$("archived").addEventListener("click", () => { state.archived = !state.archived; draw(); });
each("[data-filter]", (button) => button.addEventListener("click", () => { state.filter = button.dataset.filter; draw(); }));
for (const field of ["title", "category", "body"]) $(field).addEventListener("input", (event) => edit({ [field]: event.target.value }));
for (const key of ["kind", "scope"]) each(`[data-${key}]`, (button) => button.addEventListener("click", () => { edit({ [key]: button.dataset[key] }); renderEditor(state); }));
each("[data-variable]", (button) => button.addEventListener("click", () => insertVariable(button.dataset.variable)));
$("toggle-variables").addEventListener("click", () => {
  const expanded = $("toggle-variables").getAttribute("aria-expanded") !== "true";
  $("toggle-variables").setAttribute("aria-expanded", String(expanded)); $("variable-content").hidden = !expanded;
});
$("editor").addEventListener("submit", (event) => { event.preventDefault(); void save(); });
$("archive-entry").addEventListener("click", () => save({ ...state.current, archived: !state.current.archived }));
$("cancel").addEventListener("click", cancelEdit); $("preview").addEventListener("click", preview);
$("close-preview").addEventListener("click", () => { invalidate(); draw(); $("preview").focus(); });
$("copy").addEventListener("click", () => action(async () => {
  await call("library.copy", { text: $("preview-text").value, projectKey: state.preview.projectKey }); notify("已复制，可粘贴到所需位置");
}));
window.pluginBridge.on("workspace:changed", () => {
  invalidate();
  if (state.dirty || state.busy) { state.locked = true; notify("项目已切换，请先取消修改或刷新后再继续。", true); draw(); }
  else void reload();
});
void reload();
