/* Belfry 协作收件箱 · 只读原型
 * 人类只看：有哪些会话、各自收到的消息、必要状态。合并、调度、发送由 Agent 与后台完成。
 * 字段口径对照 T60 docs/design/collaboration-inbox/api-ui.md（sessions / messages 两个只读投影）。
 * 全部数据为示例；不调用 Belfry API。地址加 #demo 会出现“演示控制”，用来模拟后台事件，不属于产品界面。
 */
(function prototypeApp() {
  const STORE = "belfry.inbox.prototype.v3", SUBMIT_MS = 1200;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (n, cls = "") => `<span class="ico ${cls}" aria-hidden="true">${(window.BELFRY_ICONS || {})[n] || ""}</span>`;

  /* ---------- 示例数据 ---------- */
  const initial = () => ({
    v: 3, selected: "be", filter: "all", theme: "dark", paused: false, clock: 30, seq: 300, armUncertain: null,
    // sessionKey 对应 (projectRoot, tabId)；同为 Codex 的会话各占一行，互不合并。
    sessions: [
      { key: "mgr", tabId: "c2d8", name: "项目经理", short: "统", agent: "Claude", availability: "ready", task: null },
      { key: "fe", tabId: "a41c", name: "前端", short: "前", agent: "Codex", availability: "busy", task: "T63 接入分页器" },
      { key: "be", tabId: "7e02", name: "后端", short: "后", agent: "Codex", availability: "busy", task: "T60 调整接口返回值" },
      { key: "qa", tabId: "3b9f", name: "测试", short: "测", agent: "Codex", availability: "offline", task: null },
      { key: "doc", tabId: "51aa", name: "文档", short: "文", agent: "Claude", availability: "ready", task: null },
    ],
    // delivery: pending / submitting / submitted / uncertain / withdrawn；handling: unconfirmed / processing / processed
    messages: [
      { id: "m085", to: "be", by: "mgr", at: -40, cls: "task", taskRef: "T60", text: "调整接口返回值：分页结构统一为 items + total，错误返回补充 code。", delivery: "submitted", handling: "processing" },
      { id: "m080", to: "be", by: "fe", at: -32, cls: "discussion", text: "两个问题想先确认一下。", questions: [{ id: "q1", text: "页码从 0 还是从 1 开始？", state: "replied", reply: "从 1 开始。" }, { id: "q2", text: "排序字段沿用 sort 还是改成 orderBy？", state: "open" }], delivery: "submitted", handling: "processing" },
      { id: "m109", to: "mgr", by: "be", at: -12, cls: "discussion", text: "建议重启后保留未送达的消息；已送达未回复的继续算待回复。", questions: [{ id: "q1", text: "可以这样定吗？", state: "open" }], delivery: "submitted", handling: "unconfirmed" },
      { id: "m110", to: "mgr", by: "fe", at: -11, cls: "discussion", text: "界面会分开展示“等待投递”和“待回复”，这个区别我会保留。", delivery: "submitted", handling: "processed" },
      { id: "m112", to: "mgr", by: "fe", at: -9, cls: "discussion", text: "想补充一个关于超时的问题，后来在讨论里解决了。", delivery: "withdrawn", handling: "unconfirmed" },
      { id: "m095", to: "fe", by: "be", at: -18, cls: "reply", replyTo: "m080", text: "页码从 1 开始。排序字段我还在确认。", delivery: "submitted", handling: "unconfirmed" },
      { id: "m111", to: "fe", by: "mgr", at: -15, cls: "fyi", text: "演示环境今晚 22:00 重启，约 10 分钟。", delivery: "submitted", handling: "unconfirmed" },
      { id: "m108", to: "fe", by: "mgr", at: -8, cls: "discussion", text: "空列表用“还没有内容”，失败用“加载失败，请重试”。", questions: [{ id: "q1", text: "需要再补一句操作指引吗？", state: "open" }], delivery: "pending", handling: "unconfirmed" },
      { id: "m107", to: "be", by: "mgr", at: -9, cls: "task", taskRef: "T64", text: "补充登录接口的边界测试：空输入、过期凭据、重复提交，并记录验证结果。", delivery: "pending", handling: "unconfirmed" },
      { id: "m101", to: "be", by: "fe", at: -6, cls: "discussion", text: "分页还有两点要对齐。", questions: [{ id: "q1", text: "total 是总记录数还是当前页条数？", state: "open" }, { id: "q2", text: "没有数据时 items 能否统一返回 []？", state: "open" }], delivery: "pending", handling: "unconfirmed" },
      { id: "m103", to: "be", by: "mgr", at: -4, cls: "discussion", text: "约束：保留已有字段名，兼容当前客户端。", delivery: "pending", handling: "unconfirmed" },
      { id: "m104", to: "be", by: "fe", at: -3, cls: "discussion", text: "分页器已准备好，收到约定就接入，上面两个问题可以一起回复。", delivery: "pending", handling: "unconfirmed" },
      { id: "m120", to: "qa", by: "mgr", at: -20, cls: "task", taskRef: "T65", text: "回归登录流程，重点看过期凭据后的跳转。", delivery: "pending", handling: "unconfirmed" },
      { id: "m121", to: "qa", by: "be", at: -14, cls: "discussion", text: "登录接口的错误码表已更新，回归时以新表为准。", delivery: "pending", handling: "unconfirmed" },
      { id: "m130", to: "doc", by: "mgr", at: -22, cls: "discussion", text: "collab.md 需要补一节“收件箱”，说明等待投递和待回复的区别。", delivery: "uncertain", handling: "unconfirmed" },
      { id: "m131", to: "doc", by: "be", at: -5, cls: "discussion", text: "收件箱状态文案以 api-ui.md 的表格为准。", delivery: "pending", handling: "unconfirmed" },
    ],
  });

  let state = load(), toastTimer = null;
  const timers = new Set();
  /* 重新打开页面 = 模拟应用重启：正在投递的消息不知道是否已写入终端，转为待核对，不自动重投。 */
  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE)); if (s?.v === 3) { s.messages.forEach((m) => { if (m.delivery === "submitting") m.delivery = "uncertain"; }); return s; } } catch {}
    return initial();
  }
  const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };

  /* ---------- 只读投影（模拟 collab_inbox_sessions / collab_inbox_messages） ---------- */
  const session = (k) => state.sessions.find((s) => s.key === k);
  const inbox = (k) => state.messages.filter((m) => m.to === k).sort((a, b) => a.at - b.at);
  const msg = (id) => state.messages.find((m) => m.id === id);
  const time = (at) => { const t = 14 * 60 + 30 + at; return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
  const openQs = (m) => (m.questions || []).filter((q) => q.state === "open");
  const pendingOf = (k) => inbox(k).filter((m) => m.delivery === "pending" && m.cls !== "fyi");
  const awaitingOf = (k) => inbox(k).filter((m) => m.delivery === "submitted").reduce((n, m) => n + openQs(m).length, 0);
  const hasUncertain = (k) => inbox(k).some((m) => m.delivery === "uncertain");

  /* 一条消息为什么还没送到 / 送到后是什么情况。文案对照 api-ui.md“具体文案”表。 */
  function messageStatus(m) {
    const s = session(m.to);
    if (m.delivery === "withdrawn") return { tone: "muted", text: "待发消息已撤回" };
    if (m.delivery === "uncertain") return { tone: "red", text: "提交结果待核对，后续投递已暂停" };
    if (m.delivery === "submitting") return { tone: "green", text: "正在投递消息" };
    if (m.delivery === "pending") {
      if (hasUncertain(m.to)) return { tone: "red", text: "提交结果待核对，后续投递已暂停" };
      if (state.paused) return { tone: "amber", text: "投递已暂停，消息已保存" };
      if (s.availability === "offline") return { tone: "amber", text: "等待成员上线" };
      if (m.cls === "task" && s.task) return { tone: "amber", text: `等待上一任务完成 · ${s.task}` };
      if (s.availability === "busy") return { tone: "amber", text: "等待成员结束当前轮次" };
      return { tone: "amber", text: "消息已收集，等待自动投递" };
    }
    if (m.cls === "fyi") return { tone: "muted", text: "仅知会，已记录" };
    if (openQs(m).length) return { tone: "blue", text: "已投递待回复" };
    if (m.cls === "task" && m.done) return { tone: "green", text: "任务已交差" };
    if (m.handling === "processed") return { tone: "green", text: "成员已报告处理完成" };
    if (m.handling === "processing") return { tone: "muted", text: m.cls === "task" ? "成员已确认处理 · 以交差为准" : "成员已确认处理" };
    return { tone: "muted", text: "已提交到终端，处理情况未知" };
  }
  /* 会话一句话状态：能共同概括才给单一原因；混合时写“部分消息等待投递”。 */
  function sessionStatus(k) {
    const pend = pendingOf(k), aw = awaitingOf(k);
    if (hasUncertain(k)) return { tone: "red", text: "提交结果待核对，后续投递已暂停" };
    if (inbox(k).some((m) => m.delivery === "submitting")) return { tone: "green", text: "正在投递消息" };
    if (pend.length) {
      const reasons = [...new Set(pend.map((m) => messageStatus(m).text))];
      return { tone: "amber", text: reasons.length === 1 ? reasons[0] : "部分消息等待投递" };
    }
    if (aw) return { tone: "blue", text: "已投递待回复" };
    return { tone: "muted", text: "暂无待投递消息" };
  }
  const availText = { ready: "空闲", busy: "处理中", offline: "离线", needs_input: "等待选择" };
  const counts = (k) => { const p = pendingOf(k).length, a = awaitingOf(k); return [p && `${p} 条等待投递`, a && `${a} 个问题待回复`].filter(Boolean).join(" · "); };
  const avatar = (k, cls = "") => `<span class="avatar a-${k} ${cls}" aria-hidden="true">${esc(session(k)?.short || "?")}</span>`;
  const nameOf = (k) => session(k)?.name || k;

  /* ---------- 渲染 ---------- */
  function renderList() {
    $("#filters").innerHTML = [["all", "全部会话"], ["active", "有待处理"]].map(([id, label]) => {
      const n = id === "active" ? state.sessions.filter((s) => counts(s.key) || hasUncertain(s.key)).length : state.sessions.length;
      return `<button role="tab" aria-selected="${state.filter === id}" class="${state.filter === id ? "active" : ""}" data-action="filter" data-id="${id}">${label}<b>${n}</b></button>`;
    }).join("");
    const list = state.sessions.filter((s) => state.filter === "all" || counts(s.key) || hasUncertain(s.key));
    $("#session-list").innerHTML = list.length ? list.map((s) => {
      const st = sessionStatus(s.key), last = inbox(s.key).filter((m) => m.delivery !== "withdrawn").at(-1), c = counts(s.key);
      return `<button class="session ${state.selected === s.key ? "selected" : ""}" data-action="open" data-id="${s.key}" aria-current="${state.selected === s.key}">
        ${avatar(s.key)}<span class="session-body">
          <span class="session-top"><strong>${esc(s.name)}</strong><span class="agent">${esc(s.agent)} · ${esc(s.tabId)}</span><time>${last ? time(last.at) : ""}</time></span>
          <span class="session-status ${st.tone}"><i class="dot ${st.tone}"></i><span>${esc(st.text)}</span></span>
          ${last ? `<span class="session-preview">${esc(nameOf(last.by))}：${esc(last.text)}</span>` : ""}
          ${c ? `<span class="session-counts">${esc(c)}</span>` : ""}
        </span></button>`;
    }).join("") : `<div class="empty">${icon("Inbox")}<p>没有待处理的会话</p></div>`;
  }
  function renderMessage(m) {
    const st = messageStatus(m), qs = m.questions || [];
    const kind = { task: `任务 ${m.taskRef}`, reply: "回复", fyi: "仅知会" }[m.cls];
    const ref = m.replyTo && msg(m.replyTo);
    return `<article class="message ${m.delivery}" id="msg-${m.id}">
      ${avatar(m.by, "small")}
      <div class="message-body">
        <div class="message-meta"><strong>${esc(nameOf(m.by))}</strong>${kind ? `<span class="kind ${m.cls}">${esc(kind)}</span>` : ""}<time>${time(m.at)}</time></div>
        ${ref ? `<div class="quote">${icon("Reply")}<span>回复 ${esc(nameOf(ref.by))}：${esc(ref.text)}</span></div>` : ""}
        <p class="message-text">${esc(m.text)}</p>
        ${qs.length ? `<ol class="questions">${qs.map((q) => `<li class="${q.state}"><span class="q-text">${esc(q.text)}</span>${q.state === "replied" ? `<span class="q-state green">${icon("CheckCheck")}已回复：${esc(q.reply)}</span>` : q.state === "cancelled" ? `<span class="q-state muted">已取消</span>` : `<span class="q-state ${m.delivery === "submitted" ? "blue" : "amber"}">${m.delivery === "submitted" ? "待回复" : "尚未送达"}</span>`}</li>`).join("")}</ol>` : ""}
        <div class="message-status ${st.tone}"><i class="dot ${st.tone}"></i>${esc(st.text)}</div>
      </div></article>`;
  }
  function renderDetail() {
    const s = session(state.selected), el = $("#detail");
    if (!s) { el.innerHTML = `<div class="empty large">${icon("MessagesSquare")}<p>选择一个会话查看消息</p></div>`; return; }
    const st = sessionStatus(s.key), c = counts(s.key), msgs = inbox(s.key);
    el.innerHTML = `<header class="detail-head">
        <button class="back button subtle" data-action="back">${icon("ArrowRight", "flip")}会话</button>
        <div class="who">${avatar(s.key)}<div class="who-text"><h2>${esc(s.name)}</h2><p>${esc(s.agent)} · 会话 ${esc(s.tabId)} · ${availText[s.availability]}${s.task ? ` · 当前任务 ${esc(s.task)}` : ""}</p></div>
        <button class="button" data-action="locate" title="切到这个会话的终端">${icon("Terminal")}<span>打开会话</span></button></div>
        <div class="status-line ${st.tone}"><i class="dot ${st.tone}"></i><strong>${esc(st.text)}</strong>${c ? `<span>${esc(c)}</span>` : ""}</div>
      </header>
      <div class="messages" id="messages">${msgs.length ? msgs.map(renderMessage).join("") : `<div class="empty">${icon("Inbox")}<p>这个会话还没有收到消息</p></div>`}</div>`;
  }
  function render() {
    document.documentElement.dataset.theme = state.theme;
    $("#theme").innerHTML = icon(state.theme === "dark" ? "Sun" : "Moon");
    $("#theme").setAttribute("aria-label", state.theme === "dark" ? "切换浅色" : "切换深色");
    renderList(); renderDetail(); renderDemo(); persist();
  }
  function toast(text) { const el = $("#toast"); el.textContent = text; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3600); }
  const scrollEnd = () => requestAnimationFrame(() => { const m = $("#messages"); if (m) m.scrollTop = m.scrollHeight; });

  /* ---------- 模拟后台（不是产品界面：只有 #demo 下才能触发） ---------- */
  function dispatch() {
    if (state.paused) return;
    for (const s of state.sessions) {
      if (s.availability !== "ready" || hasUncertain(s.key) || inbox(s.key).some((m) => m.delivery === "submitting")) continue;
      const ready = inbox(s.key).filter((m) => m.delivery === "pending" && !(m.cls === "task" && s.task));
      const firstTask = ready.find((m) => m.cls === "task");
      const take = ready.filter((m) => m.cls !== "task" || m === firstTask);
      if (!take.some((m) => m.cls !== "fyi")) continue;
      take.forEach((m) => { m.delivery = "submitting"; });
      const timer = setTimeout(() => {
        timers.delete(timer);
        const fail = state.armUncertain === s.key; if (fail) state.armUncertain = null;
        take.forEach((m) => { m.delivery = fail ? "uncertain" : "submitted"; if (!fail && m.cls === "task") s.task = `${m.taskRef} ${m.text.split("：")[0].slice(0, 12)}`; });
        s.availability = "busy"; render();
      }, SUBMIT_MS);
      timers.add(timer);
    }
  }
  const demo = {
    incoming: (s) => { state.messages.push({ id: `m${++state.seq}`, to: s.key, by: s.key === "fe" ? "be" : "fe", at: ++state.clock - 30, cls: "discussion", text: "补充：超过最后一页时返回空数组，不回退。", delivery: "pending", handling: "unconfirmed" }); return "新消息进入同一会话，等待自动投递。"; },
    turn: (s) => { if (s.availability === "offline") return "会话离线，先让它上线。"; s.availability = s.availability === "busy" ? "ready" : "busy"; return s.availability === "ready" ? "成员结束当前轮次，后台自动投递可以送达的消息。" : "成员开始新一轮。"; },
    finish: (s) => { if (!s.task) return "这个会话没有进行中的任务。"; const ref = s.task.split(" ")[0]; inbox(s.key).forEach((m) => { if (m.taskRef === ref) { m.done = true; m.handling = "processed"; } }); s.task = null; s.availability = "ready"; return `已交差 ${ref}，排队的新任务可以送达。`; },
    answer: (s) => {
      const m = inbox(s.key).find((x) => x.delivery === "submitted" && openQs(x).length);
      if (!m) return "这个会话没有待回复的问题。";
      const q = openQs(m)[0]; q.state = "replied"; q.reply = "已确认，按这个来。";
      state.messages.push({ id: `m${++state.seq}`, to: m.by, by: s.key, at: ++state.clock - 30, cls: "reply", replyTo: m.id, text: `关于“${q.text}”——已确认，按这个来。`, delivery: "pending", handling: "unconfirmed" });
      return `${s.name}回复了 1 个问题，其余问题仍待回复；回复已排进${nameOf(m.by)}的会话。`;
    },
    online: (s) => { s.availability = s.availability === "offline" ? "ready" : "offline"; return s.availability === "offline" ? "会话离线，消息保留不投递。" : "会话上线，保留的消息按顺序投递。"; },
    uncertain: (s) => { state.armUncertain = s.key; return "下一次投递将模拟“提交结果不确定”。"; },
    verify: (s) => { const u = inbox(s.key).filter((m) => m.delivery === "uncertain"); if (!u.length) return "没有待核对的投递。"; u.forEach((m) => { m.delivery = "submitted"; }); return "已在终端核对：确认送达，后续投递恢复。"; },
    pause: () => { state.paused = !state.paused; return state.paused ? "房间投递已暂停，新消息继续保存。" : "房间投递已恢复。"; },
    reset: () => { timers.forEach(clearTimeout); timers.clear(); const theme = state.theme; state = initial(); state.theme = theme; return "已还原示例。"; },
  };
  function renderDemo() {
    const p = $("#demo-panel");
    p.hidden = location.hash !== "#demo";
    document.body.classList.toggle("demo-on", !p.hidden);
    if (p.hidden) return;
    const s = session(state.selected);
    p.innerHTML = `<div class="demo-head"><strong>演示控制</strong><span>模拟后台事件，不属于产品界面 · 作用于「${esc(s?.name)}」</span></div>
      <div class="demo-grid">${[["incoming", "新消息到达"], ["turn", s?.availability === "busy" ? "结束当前轮次" : "开始新一轮"], ["finish", "交差当前任务"], ["answer", "回复一个问题"], ["online", s?.availability === "offline" ? "会话上线" : "会话离线"], ["uncertain", "下次提交不确定"], ["verify", "核对：已送达"], ["pause", state.paused ? "恢复房间投递" : "暂停房间投递"], ["reset", "重置示例"]].map(([id, label]) => `<button data-action="demo" data-id="${id}">${label}</button>`).join("")}</div>`;
  }

  /* ---------- 交互 ---------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]"); if (!b || b.disabled) return;
    const a = b.dataset.action, id = b.dataset.id;
    if (a === "open") { state.selected = id; $("#app").classList.add("show-detail"); render(); $("#detail .back")?.focus({ preventScroll: true }); scrollEnd(); return; }
    if (a === "back") { $("#app").classList.remove("show-detail"); render(); document.querySelector(`.session[data-id="${state.selected}"]`)?.focus(); return; }
    if (a === "filter") state.filter = id;
    else if (a === "theme") state.theme = state.theme === "dark" ? "light" : "dark";
    else if (a === "locate") toast(`原型：真实应用会切到「${nameOf(state.selected)}」的终端（会话 ${session(state.selected).tabId}）。`);
    else if (a === "demo") { toast(demo[id](session(state.selected))); dispatch(); }
    render();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#app").classList.contains("show-detail")) { $("#app").classList.remove("show-detail"); render(); } });
  window.addEventListener("hashchange", render);
  render(); scrollEnd();
  window.__prototypeReady = true;
  window.__prototypeState = () => state;
})();
