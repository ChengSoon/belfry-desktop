export const $ = (id) => document.getElementById(id);
export const each = (selector, callback) => document.querySelectorAll(selector).forEach(callback);

export function notify(text = "", error = false) {
  $("notice").textContent = text; $("notice").hidden = !text; $("notice").classList.toggle("error", error);
}

export function renderList(state, select) {
  const query = state.query.toLocaleLowerCase();
  const entries = (state.snapshot?.entries ?? []).filter((entry) => entry.archived === state.archived
    && (state.filter === "all" || entry.kind === state.filter)
    && `${entry.title} ${entry.body} ${entry.category}`.toLocaleLowerCase().includes(query));
  $("count").textContent = `${entries.length} 项${state.archived ? "归档" : "收藏"}`;
  $("entries").replaceChildren();
  for (const entry of entries) {
    const button = document.createElement("button"), title = document.createElement("strong"), detail = document.createElement("small");
    button.type = "button"; button.className = "entry"; button.setAttribute("aria-current", String(state.current?.id === entry.id));
    button.disabled = state.busy || state.dirty; title.textContent = entry.title;
    detail.textContent = [entry.kind === "prompt" ? "Prompt" : "命令", entry.scope === "global" ? "全局" : "此项目", entry.category].filter(Boolean).join(" · ");
    button.append(title, detail); button.addEventListener("click", () => select(entry)); $("entries").append(button);
  }
  if (!entries.length) { const empty = document.createElement("p"); empty.className = "list-empty"; empty.textContent = state.archived ? "没有匹配的归档" : "还没有匹配的收藏"; $("entries").append(empty); }
}

export function renderEditor(state) {
  const entry = state.current; $("empty").hidden = !!entry; $("editor").hidden = !entry;
  if (!entry) return;
  for (const key of ["title", "category", "body"]) $(key).value = entry[key];
  each("[data-kind]", (button) => button.setAttribute("aria-pressed", String(button.dataset.kind === entry.kind)));
  each("[data-scope]", (button) => button.setAttribute("aria-pressed", String(button.dataset.scope === entry.scope)));
  $("scope-note").textContent = entry.id ? entry.scope === "global" ? "全局收藏" : `项目 · ${state.snapshot.workspace?.name ?? "当前项目"}` : "新建收藏";
  $("archive-entry").textContent = entry.archived ? "恢复收藏" : "归档";
}

export function renderState(state, select) {
  const blocked = state.busy || state.locked || !state.snapshot;
  $("workspace").textContent = state.snapshot?.workspace ? `${state.snapshot.workspace.name} · 含全局收藏` : "全局收藏 · 打开项目后可按项目保存";
  $("workspace").title = state.snapshot?.workspace?.path ?? "";
  $("new").disabled = blocked || state.dirty; $("refresh").disabled = state.busy || state.dirty;
  $("fields").disabled = blocked; $("save").disabled = blocked || !state.dirty; $("preview").disabled = blocked;
  $("cancel").disabled = state.busy || !state.dirty; $("archive-entry").disabled = blocked || state.dirty || !state.current?.id;
  each('[data-scope="project"]', (button) => { button.disabled = blocked || !state.snapshot?.workspace; });
  $("draft-state").textContent = state.dirty ? "有未保存的修改" : "已保存";
  $("archived").setAttribute("aria-pressed", String(state.archived)); $("archived").textContent = state.archived ? "返回收藏" : "查看归档";
  each("[data-filter]", (button) => button.setAttribute("aria-pressed", String(state.filter === button.dataset.filter)));
  $("copy").disabled = blocked || !state.preview;
  renderList(state, select);
}
