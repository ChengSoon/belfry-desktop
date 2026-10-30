'use strict';
/*
 * 协作房间 · 交互原型脚本（合成数据，无真实 Agent / 模型 / 文件系统调用）。
 *
 * 数据契约（v2，按 2026-10-28 确认的房间模型修订）：
 * - 房间是常驻的协作组：只拉成员，不绑定目标。任务由用户随时发送给指定成员，可任意追加、并行。
 * - 同一个 Agent 可反复加入，每次生成独立 memberId 与会话标识；消息、任务负责人一律按 memberId 寻址。
 * - 发任务 = 写内容 + 选中接收者（可多选），发送即开工；不选接收者即为普通讨论。
 * - 任务状态：运行中 →（暂停 / 恢复）→ 已提交待验证 → 验证通过；停止需确认并保留产物。验证独立于提交。
 * - 全部状态只活在页面内存中，刷新即重置；示例自动过程明确声明为合成推进。
 *
 * 测试钩子：window.belfryRoom = { state, step(n), setAuto(bool) }。
 * 默认以 700ms 一拍推进运行中的任务；URL 带 ?auto=0（隔离测试用）时改为手动 step()。
 */
(() => {
  // ---------- 基础工具 ----------
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let uidSeq = 0;
  const uid = prefix => `${prefix}-${(++uidSeq).toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const pad = n => String(n).padStart(2, '0');
  const hhmm = at => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const initial = role => [...String(role).trim()][0] ?? '·';
  const btn = (label, action, kind = '', attrs = '') =>
    `<button type="button" class="button${kind ? ' button--' + kind : ''}" data-action="${action}" ${attrs}>${label}</button>`;
  const summarize = text => {
    const flat = text.trim().replace(/\s+/g, ' ');
    return flat.length > 18 ? `${flat.slice(0, 18)}…` : flat;
  };

  // ---------- 合成数据 ----------
  // 「配置名称」而非安装声明：原型不检测本机是否安装这些 Agent。
  const AGENTS = [
    { id: 'claude-code', name: 'Claude Code', note: '通用实现与重构' },
    { id: 'codex', name: 'Codex', note: '代码审查与方案推敲' },
    { id: 'pi', name: 'Pi', note: '测试与文档整理' },
  ];
  const agentOf = id => AGENTS.find(a => a.id === id) ?? { id: 'unknown', name: '未命名 Agent', note: '' };

  const seedAt = minutes => Date.now() - minutes * 60000;
  const SPEC_BLOCKS = [
    { h: '背景' },
    { p: '登录流程的现状：失败提示散落在多处、会话过期会打断用户。这份参考规格用于讨论与派活的共同上下文。' },
    { h: '范围' },
    { ul: ['登录失败的内联错误与重试', '会话过期的自动跳转与目标路由保留', '回归清单与验证记录'] },
    { h: '非目标' },
    { ul: ['不改造第三方登录', '不改动密码策略'] },
    { p: '本规格为合成示例，用于表达交付形态。' },
  ];
  const diffBody = taskId => [
    { t: 'file', v: `diff --git a/src/demo/${taskId}.tsx b/src/demo/${taskId}.tsx` },
    { t: 'hunk', v: '@@ -14,6 +14,8 @@ export function Demo() {' },
    { t: 'del', v: '-  // TODO: 示例占位实现' },
    { t: 'add', v: '+  // 合成示例：按派活要求实现的主路径' },
    { t: 'add', v: '+  if (failed) showInlineError(reason);' },
    { t: 'ctx', v: '   return next();' },
  ];
  const CREATE_NOTE = '房间已创建（合成演示）。先拉成员进来，再把任务随时发给他们。';

  const state = {
    theme: 'dark',
    layout: 'balanced',
    view: 'discussion',
    search: '',
    drawer: null,
    menu: null,
    roomId: 'r-login',
    clock: 0,
    auto: true,
    rooms: [
      {
        id: 'r-login',
        name: '登录体验小组',
        members: [
          { memberId: 'm-cc-main', agentId: 'claude-code', role: '主力实现', duty: '实现主要改动并维护改动说明', session: 'sess-4f2a01' },
          { memberId: 'm-cc-login', agentId: 'claude-code', role: '登录页实现', duty: '实现登录页交互与错误处理', session: 'sess-4f2a02' },
          { memberId: 'm-cx-review', agentId: 'codex', role: '代码审查', duty: '审查实现改动、边界条件与回归风险', session: 'sess-9b3c07' },
          { memberId: 'm-pi-e2e', agentId: 'pi', role: '端到端测试', duty: '维护回归清单并产出验证记录', session: 'sess-2d8e11' },
        ],
        messages: [
          { id: 'msg-101', at: seedAt(58), kind: 'system', text: CREATE_NOTE },
          { id: 'msg-102', at: seedAt(52), kind: 'msg', author: 'm-cc-login', text: '现状梳理：错误提示散落在三个组件里，重试逻辑缺失。建议先统一成内联错误，再补重试。', recipientIds: [], quote: null, taskId: null },
          { id: 'msg-103', at: seedAt(49), kind: 'msg', author: 'm-cx-review', text: '同意，另外会话过期的跳转要保留目标路由，否则用户回来会丢上下文。', recipientIds: [], quote: null, taskId: null },
          { id: 'msg-104', at: seedAt(44), kind: 'msg', author: 'user', text: '把登录失败的错误提示统一成内联样式，并补上重试按钮；重试不刷新页面。', recipientIds: ['m-cc-login'], quote: null, taskId: 't-101' },
          { id: 'msg-106', at: seedAt(30), kind: 'decision', author: 'm-cc-main', text: '登录失败统一使用内联错误提示，不使用弹窗；重试不刷新页面。' },
        ],
        tasks: [
          { id: 't-101', title: '登录失败：内联错误与重试', text: '把登录失败的错误提示统一成内联样式，并补上重试按钮；重试不刷新页面。', owners: ['m-cc-login'], state: 'running', progress: 40, evidence: [], artifacts: [], acceptance: ['失败原因以可读中文文案展示', '提供重试按钮，且不刷新页面', '错误状态可用键盘关闭'], createdAt: seedAt(44) },
          { id: 't-102', title: '会话过期自动跳转，保留目标路由', text: '会话过期后自动跳转登录页，并保留用户原目标路由；跳转前给出提示。', owners: ['m-cc-login'], state: 'submitted', progress: 100, evidence: ['改动范围：登录相关组件与路由（合成示例，未真实执行）', '自检结论：逐条对照验收条件，证据见差异产物'], artifacts: ['a-102'], acceptance: ['过期后数秒内跳转登录页', '跳转保留原目标路由', '跳转前提示会话已过期'], createdAt: seedAt(62) },
          { id: 't-103', title: '登录回归清单与验证记录', text: '整理登录回归清单，覆盖错误、过期、重试三条主路径，并关联证据。', owners: ['m-pi-e2e'], state: 'verified', progress: 100, evidence: ['改动范围：测试清单与验证记录（合成示例）'], artifacts: ['a-103'], acceptance: ['覆盖错误、过期、重试三条主路径', '验证记录关联验收条件与证据'], createdAt: seedAt(72) },
        ],
        artifacts: [
          { id: 'a-101', kind: 'spec', title: '登录改造 · 参考规格（合成）', by: 'm-cc-main', at: seedAt(56), task: null, body: SPEC_BLOCKS },
          { id: 'a-102', kind: 'diff', title: '会话过期自动跳转，保留目标路由 · 改动差异（合成）', by: 'm-cc-login', at: seedAt(47), task: 't-102', body: diffBody('t-102') },
          { id: 'a-103', kind: 'record', title: '登录回归清单与验证记录 · 验证记录（合成）', by: 'm-pi-e2e', at: seedAt(60), task: 't-103', body: ['覆盖错误、过期、重试三条主路径', '验证记录关联验收条件与证据'].map((text, i) => ({ text, note: `第 ${i + 1} 条：合成验证通过，证据见关联差异产物` })) },
        ],
        decisions: [
          { id: 'd-101', by: 'm-cc-main', text: '登录失败统一使用内联错误提示，不使用弹窗；重试不刷新页面。', at: seedAt(30) },
        ],
        draft: { text: '', recipientIds: [], quoteId: null },
      },
      {
        id: 'r-export',
        name: '导出性能小组',
        members: [
          { memberId: 'm-cx-perf', agentId: 'codex', role: '性能评审', duty: '评审采样方法与结论', session: 'sess-7a1d22' },
          { memberId: 'm-pi-perf', agentId: 'pi', role: '性能剖析', duty: '执行采样并记录热点函数', session: 'sess-7a1d23' },
        ],
        messages: [
          { id: 'msg-201', at: seedAt(18), kind: 'system', text: CREATE_NOTE },
          { id: 'msg-202', at: seedAt(15), kind: 'msg', author: 'user', text: '先采样 1 万行长列表的导出耗时，输出热点函数排名。', recipientIds: ['m-pi-perf'], quote: null, taskId: 't-201' },
        ],
        tasks: [
          { id: 't-201', title: '1 万行长列表导出耗时采样', text: '采样 1 万行长列表的导出耗时，输出热点函数排名。', owners: ['m-pi-perf'], state: 'running', progress: 20, evidence: [], artifacts: [], acceptance: ['采样 1 万行导出耗时', '输出热点函数排名'], createdAt: seedAt(15) },
        ],
        artifacts: [],
        decisions: [],
        draft: { text: '', recipientIds: [], quoteId: null },
      },
    ],
  };

  const room = () => state.rooms.find(r => r.id === state.roomId) ?? state.rooms[0];
  const memberOf = (r, memberId) => r.members.find(m => m.memberId === memberId) ?? null;
  const taskOf = (r, taskId) => r.tasks.find(t => t.id === taskId) ?? null;
  const isMemberBusy = (r, memberId) => r.tasks.some(t => t.owners.includes(memberId) && (t.state === 'running' || t.state === 'paused'));
  const ownerLabel = owners => owners.map(id => memberOf(room(), id)?.role).filter(Boolean).join('、');

  const TASK_LABEL = { running: '运行中', paused: '已暂停', submitted: '已提交待验证', verified: '验证通过', stopped: '已停止' };
  function taskChip(taskState) {
    const inner = taskState === 'paused' ? icon('pause')
      : taskState === 'verified' ? icon('check')
      : taskState === 'stopped' ? icon('stop')
      : '<span class="dot"></span>';
    return `<span class="chip chip--${taskState}">${inner}${TASK_LABEL[taskState]}</span>`;
  }
  function progressHtml(pct) {
    return `<span class="progress-wrap"><span class="progress"><span class="progress__fill" style="width:${pct}%"></span></span><span class="progress__pct">${pct}%</span></span>`;
  }
  function ownerStack(r, owners) {
    return `<span class="owner-stack">${owners.map(id => {
      const m = memberOf(r, id);
      return m ? `<span class="member-avatar" title="${esc(m.role)} · ${esc(agentOf(m.agentId).name)}">${esc(initial(m.role))}</span>` : '';
    }).join('')}<span>${esc(owners.map(id => memberOf(r, id)?.role ?? '').filter(Boolean).join('、'))}</span></span>`;
  }
  function emptyState(iconName, title, hint, extra = '') {
    return `<div class="empty"><span class="empty__icon">${icon(iconName)}</span><h3>${title}</h3><p>${hint}</p>${extra}</div>`;
  }
  const addSys = (r, text) => r.messages.push({ id: uid('msg'), at: Date.now(), kind: 'system', text });

  let toastTimer = null;
  function toast(message) {
    clearTimeout(toastTimer);
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('visible');
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2400);
  }

  // ---------- 渲染 ----------
  function render() {
    renderRooms();
    renderMembers();
    renderHeader();
    renderTabs();
    renderContent();
    renderInspector();
    renderComposer();
    syncDrawers();
  }

  function renderRooms() {
    $('#room-list').innerHTML = state.rooms.map(r => {
      const active = r.id === state.roomId;
      const running = r.tasks.some(t => t.state === 'running');
      const paused = !running && r.tasks.some(t => t.state === 'paused');
      const dot = running
        ? '<span class="run-dot run-dot--running" title="有任务在运行"></span>'
        : paused ? '<span class="run-dot" title="有任务已暂停"></span>' : '';
      return `<button class="room-item" data-room-id="${r.id}" aria-current="${active}" title="${esc(r.name)}">
        ${dot}<span class="room-name">${esc(r.name)}</span><small>${r.members.length} 人</small>
      </button>`;
    }).join('');
  }

  function renderMembers() {
    const r = room();
    $('#member-count').textContent = String(r.members.length);
    $('#member-list').innerHTML = r.members.map(m => {
      const busy = isMemberBusy(r, m.memberId);
      return `<button class="member-row" data-member-id="${m.memberId}" title="查看成员详情：${esc(m.role)}">
        <span class="member-avatar">${esc(initial(m.role))}</span>
        <span class="member-role">${esc(m.role)}<small>${esc(agentOf(m.agentId).name)}</small></span>
        <span class="status-dot ${busy ? 'status-dot--running' : ''}" title="${busy ? '有任务进行中' : '空闲'}"></span>
      </button>`;
    }).join('');
  }

  function renderHeader() {
    const r = room();
    $('#room-title').textContent = r.name;
    const shown = r.members.slice(0, 5);
    $('#header-avatars').innerHTML = shown
      .map(m => `<button class="mini-avatar" data-member-id="${m.memberId}" title="${esc(m.role)} · ${esc(agentOf(m.agentId).name)}">${esc(initial(m.role))}</button>`)
      .join('') + (r.members.length > shown.length ? `<span class="avatar-stack__more">+${r.members.length - shown.length}</span>` : '');
  }

  function renderTabs() {
    const r = room();
    $('#task-count').textContent = String(r.tasks.length);
    $('#artifact-count').textContent = String(r.artifacts.length);
    $$('.tabs [role="tab"]').forEach(tab => {
      const active = tab.dataset.view === state.view;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $('#room-content').setAttribute('aria-labelledby', `tab-${state.view}`);
  }

  function renderContent() {
    const content = $('#room-content');
    const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 48;
    const prevTop = content.scrollTop;
    content.innerHTML = state.view === 'discussion' ? discussionView()
      : state.view === 'tasks' ? tasksView()
      : artifactsView();
    content.scrollTop = atBottom ? content.scrollHeight : prevTop;
  }

  function messageSearchText(r, m) {
    const author = m.author === 'user' ? '我' : memberOf(r, m.author)?.role ?? '';
    const recipients = (m.recipientIds ?? []).map(id => memberOf(r, id)?.role ?? '').join(' ');
    return `${author} ${recipients} ${m.text}`;
  }

  function discussionView() {
    const r = room();
    const query = state.search.trim().toLowerCase();
    let messages = r.messages;
    if (query) messages = messages.filter(m => messageSearchText(r, m).toLowerCase().includes(query));
    if (query && !messages.length) {
      return emptyState('search', '没有匹配的消息', '换一个关键词，或关闭搜索查看全部讨论。');
    }
    // 刚创建的房间只有系统事件：仍然展示空态与拉成员、发任务的引导，系统事件按时间留在上方。
    if (!query && !messages.some(m => m.kind === 'msg')) {
      return (messages.length ? `<div class="timeline">${messages.map(m => messageHtml(r, m)).join('')}</div>` : '')
        + emptyState('chat', '房间还是空的', '先添加成员，然后把任务随时发给他们；不选接收者的消息就是普通讨论。', btn('添加成员', 'add-member'));
    }
    const note = query ? `<p class="sys-event" data-testid="search-note">${icon('search')}<span>匹配 ${messages.length} 条消息</span></p>` : '';
    return `<div class="timeline">${note}${messages.map(m => messageHtml(r, m)).join('')}</div>`;
  }

  function messageHtml(r, m) {
    if (m.kind === 'system') {
      return `<p class="sys-event">${icon('check')}<span>${esc(m.text)}</span><span class="mono">${hhmm(m.at)}</span></p>`;
    }
    if (m.kind === 'decision') {
      const author = m.author === 'user' ? '我' : memberOf(r, m.author)?.role ?? '成员';
      return `<p class="sys-event sys-event--decision" data-msg-id="${m.id}">${icon('check')}<span>${esc(author)} 记录了决定：${esc(m.text)}</span><span class="mono">${hhmm(m.at)}</span></p>`;
    }
    const isUser = m.author === 'user';
    const author = isUser ? { role: '我' } : memberOf(r, m.author);
    const source = isUser ? '<span class="msg__source">你</span>'
      : `<span class="msg__source">${esc(agentOf(author.agentId).name)}</span>`;
    const recipients = (m.recipientIds ?? []).map(id => memberOf(r, id)).filter(Boolean);
    const chip = recipients.length ? `<span class="msg__chip">→ @${esc(recipients.map(x => x.role).join('、'))}</span>` : '';
    const quote = m.quote ? quoteHtml(r, m.quote) : '';
    const task = m.taskId ? taskOf(r, m.taskId) : null;
    const taskCard = task
      ? `<button type="button" class="msg__task" data-task-id="${task.id}" title="查看任务详情">
          ${taskChip(task.state)}<span class="msg__task-title">${esc(task.title)}</span>${icon('chevron')}
        </button>`
      : '';
    const actions = `<div class="msg__actions">
      <button type="button" data-msg-action="quote" data-msg-id="${m.id}">${icon('reply')}引用</button>
      <button type="button" data-msg-action="decision" data-msg-id="${m.id}">${icon('check')}标记为决定</button>
    </div>`;
    return `<article class="msg${isUser ? ' msg--user' : ''}" data-msg-id="${m.id}">
      <span class="msg__avatar">${esc(isUser ? '我' : initial(author.role))}</span>
      <div>
        <div class="msg__head">
          <span class="msg__author">${esc(author.role)}</span>${source}${chip}
          <time class="msg__time">${hhmm(m.at)}</time>
        </div>
        <p class="msg__body">${esc(m.text)}</p>
        ${taskCard}${quote}${actions}
      </div>
    </article>`;
  }

  function quoteHtml(r, quoteId) {
    const q = r.messages.find(x => x.id === quoteId);
    if (!q) return '';
    const author = q.author === 'user' ? '我' : memberOf(r, q.author)?.role ?? '成员';
    return `<button type="button" class="quote" data-quote-id="${q.id}" title="跳到原消息"><b>${esc(author)}</b><span>${esc(q.text.slice(0, 90))}</span></button>`;
  }

  function tasksView() {
    const r = room();
    if (!r.tasks.length) {
      return emptyState('tasks', '还没有任务', '在输入框写清要做什么、选中接收者，发送就会把任务派给他们。');
    }
    return `<div class="view-pad">${r.tasks.map(t => `
      <button class="row-card" data-task-id="${t.id}" data-testid="task-item">
        <span class="task-row__top">
          <span class="task-row__title">${esc(t.title)}</span>
          ${taskChip(t.state)}
        </span>
        <span class="task-row__meta">
          ${ownerStack(r, t.owners)}
          <span>·</span><span>验收 ${t.acceptance.length} 条</span>
          ${t.artifacts.length ? `<span>·</span><span>${t.artifacts.length} 件产物</span>` : ''}
        </span>
        ${progressHtml(t.state === 'verified' || t.state === 'submitted' ? 100 : t.progress)}
      </button>`).join('')}</div>`;
  }

  const ARTIFACT_KIND = { spec: { label: '规格', icon: 'file' }, diff: { label: '代码差异', icon: 'branch' }, record: { label: '验证记录', icon: 'check' } };
  function artifactsView() {
    const r = room();
    if (!r.artifacts.length) {
      return emptyState('file', '还没有产物', '任务提交后会生成代码差异和验证记录，在这里查看。');
    }
    return `<div class="view-pad">${r.artifacts.map(a => {
      const meta = ARTIFACT_KIND[a.kind] ?? ARTIFACT_KIND.file;
      const from = a.task ? taskOf(r, a.task) : null;
      return `<button class="row-card" data-artifact-id="${a.id}" data-testid="artifact-item">
        <span class="artifact-row__top">
          <span class="artifact-kind">${icon(meta.icon)}${meta.label}</span>
          <span class="artifact-row__title">${esc(a.title)}</span>
        </span>
        <span class="artifact-row__meta">${from ? `来自任务「${esc(from.title)}」 · ` : ''}${hhmm(a.at)} · 合成示例</span>
      </button>`;
    }).join('')}</div>`;
  }

  function renderInspector() {
    const r = room();
    const active = r.tasks.filter(t => t.state === 'running' || t.state === 'paused' || t.state === 'submitted');
    const done = r.tasks.filter(t => t.state === 'verified').length;
    const activeCards = active.length ? active.map(t => {
      const controls = t.state === 'submitted'
        ? `${btn('验证通过', 'task-verify', 'primary', `data-testid="task-verify" data-task-id="${t.id}"`)}${btn('打开详情', 'open-task', '', `data-testid="open-task" data-task-id="${t.id}"`)}`
        : `${t.state === 'running'
            ? btn('暂停', 'run-pause', '', `data-testid="run-pause" data-task-id="${t.id}"`)
            : btn('恢复', 'run-resume', 'primary', `data-testid="run-resume" data-task-id="${t.id}"`)}
          ${btn('停止', 'run-stop', 'danger', `data-testid="run-stop" data-task-id="${t.id}"`)}`;
      const meta = t.state === 'running' ? '运行中 · 合成数据推进'
        : t.state === 'paused' ? '已暂停 · 进度已冻结'
        : '已提交待验证 · 验证独立于提交';
      return `<div class="insp-card run-card">
        <div class="task-row__top"><span class="run-card__title">${esc(t.title)}</span>${taskChip(t.state)}</div>
        <div class="run-card__meta">${ownerStack(r, t.owners)} · ${meta}</div>
        ${progressHtml(t.progress)}
        <div class="run-controls">${controls}</div>
      </div>`;
    }).join('') : '<div class="insp-card run-card"><div class="run-card__title">没有进行中的任务</div><div class="run-card__meta">在输入框写清要做什么、选中接收者，发送就会把任务派给他们。</div></div>';

    $('#inspector').innerHTML = `
      <div class="insp-head"><span>任务与进展</span>
        <button type="button" class="icon-button icon-button--sm mobile-only" data-action="close-drawers" aria-label="关闭任务面板">${icon('close')}</button>
      </div>
      <section class="insp-section">
        <div class="insp-label"><span>进行中</span><span class="mono">已完成 ${done}</span></div>
        <div class="active-task-list">${activeCards}</div>
      </section>
      <section class="insp-section">
        <div class="insp-label"><span>已确认决定</span></div>
        ${r.decisions.length ? `<div class="decision-list">${r.decisions.map(d => {
          const by = d.by === 'user' ? '我' : memberOf(r, d.by)?.role ?? '成员';
          return `<div class="decision"><p>${esc(d.text)}</p><div class="decision-meta"><span>${esc(by)}</span><span class="mono">${hhmm(d.at)}</span></div></div>`;
        }).join('')}</div>` : '<p class="run-card__meta" style="margin:0">还没有已确认决定。在讨论里用「标记为决定」记录结论。</p>'}
      </section>`;
  }

  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }

  function recipientLabel(r) {
    const chosen = r.draft.recipientIds.map(id => memberOf(r, id)).filter(Boolean);
    if (!chosen.length) return '选择接收者';
    return chosen.length === 1 ? `@${chosen[0].role}` : `@${chosen[0].role} 等 ${chosen.length} 人`;
  }

  function renderComposer() {
    const r = room();
    const input = $('#message-input');
    if (input.value !== r.draft.text) input.value = r.draft.text;
    autosize(input);
    $('#recipient-button').querySelector('span:not(.at-sign)').textContent = recipientLabel(r);
    $('#recipient-button').setAttribute('aria-expanded', String(state.menu === 'recipients'));
    $('#send-message').disabled = !r.draft.text.trim();
    const chosen = r.draft.recipientIds.map(id => memberOf(r, id)).filter(Boolean);
    $('#composer-note-text').textContent = chosen.length
      ? `发送即把任务派给 @${chosen.map(m => m.role).join('、')}（合成推进）`
      : '消息公开可见；选中成员后发送，就会把任务派给他们';
    const preview = $('#reply-preview');
    const quoted = r.draft.quoteId ? r.messages.find(m => m.id === r.draft.quoteId) : null;
    if (quoted) {
      const author = quoted.author === 'user' ? '我' : memberOf(r, quoted.author)?.role ?? '成员';
      preview.hidden = false;
      preview.innerHTML = `引用 <b>${esc(author)}</b>：<span>${esc(quoted.text.slice(0, 60))}</span>
        <button type="button" class="icon-button icon-button--sm" data-action="cancel-quote" aria-label="取消引用">${icon('close')}</button>`;
    } else {
      r.draft.quoteId = null;
      preview.hidden = true;
      preview.innerHTML = '';
    }
  }

  // ---------- 抽屉与菜单 ----------
  function syncDrawers() {
    document.documentElement.classList.toggle('drawer-sidebar', state.drawer === 'sidebar');
    document.documentElement.classList.toggle('drawer-inspector', state.drawer === 'inspector');
    $('.drawer-backdrop').hidden = !state.drawer;
    const inspectorBtn = $('[data-action="inspector"]');
    const drawerMode = state.layout === 'focus' || window.matchMedia('(max-width: 1120px)').matches;
    inspectorBtn.setAttribute('aria-pressed', String(drawerMode
      ? state.drawer === 'inspector'
      : document.documentElement.classList.contains('inspector-collapsed')));
  }
  function toggleDrawer(name) {
    state.drawer = state.drawer === name ? null : name;
    syncDrawers();
  }
  function closeAllDrawers() {
    state.drawer = null;
    syncDrawers();
  }
  function toggleInspector() {
    const drawerMode = state.layout === 'focus' || window.matchMedia('(max-width: 1120px)').matches;
    if (drawerMode) toggleDrawer('inspector');
    else document.documentElement.classList.toggle('inspector-collapsed');
    syncDrawers();
  }

  function closeMenu() {
    state.menu = null;
    $('#recipients-menu')?.remove();
    $('#mentions-menu')?.remove();
    $('#recipient-button').setAttribute('aria-expanded', 'false');
  }
  function recipientsMenuHtml(r) {
    const items = r.members.length
      ? r.members.map(m => {
        const checked = r.draft.recipientIds.includes(m.memberId);
        return `<button type="button" class="menu__item" role="menuitemcheckbox" aria-checked="${checked}"
          data-action="toggle-recipient" data-testid="recipient-option" data-member-id="${m.memberId}">
          <span class="check-slot">${checked ? icon('check') : ''}</span>
          <span class="member-avatar">${esc(initial(m.role))}</span>
          <span>@${esc(m.role)}</span>
          <small>${esc(agentOf(m.agentId).name)}</small>
        </button>`;
      }).join('')
      : '<div class="menu__empty">还没有成员。先添加成员，再派任务给他们。</div>';
    return `<div class="menu menu--recipients" id="recipients-menu" role="menu" aria-label="选择任务接收者">
      <div class="menu__head">选中的成员会收到任务（可多选）；不选则为普通讨论</div>
      ${items}
      <div class="menu__foot">${btn('完成', 'close-menu', 'quiet button--sm')}</div>
    </div>`;
  }
  function toggleRecipientsMenu() {
    if (state.menu === 'recipients') { closeMenu(); return; }
    closeMenu();
    state.menu = 'recipients';
    $('#composer-wrap').insertAdjacentHTML('beforeend', recipientsMenuHtml(room()));
    $('#recipient-button').setAttribute('aria-expanded', 'true');
  }
  function openMentionsMenu(query) {
    const r = room();
    const lowered = query.toLowerCase();
    const list = r.members.filter(m => m.role.toLowerCase().includes(lowered) || agentOf(m.agentId).name.toLowerCase().includes(lowered));
    closeMenu();
    state.menu = 'mentions';
    $('#composer-wrap').insertAdjacentHTML('beforeend', `<div class="menu menu--mentions" id="mentions-menu" role="menu" aria-label="点名成员">
      ${list.length ? list.map(m => `<button type="button" class="menu__item" role="menuitem" data-action="pick-mention" data-member-id="${m.memberId}">
        <span class="member-avatar">${esc(initial(m.role))}</span><span>@${esc(m.role)}</span><small>${esc(agentOf(m.agentId).name)}</small>
      </button>`).join('') : '<div class="menu__empty">没有匹配的成员</div>'}
    </div>`);
  }
  function updateMentionMenu() {
    const input = $('#message-input');
    const caret = input.selectionStart ?? input.value.length;
    const match = input.value.slice(0, caret).match(/@[^@\s]{0,20}$/);
    if (match) openMentionsMenu(match[0].slice(1));
    else if (state.menu === 'mentions') closeMenu();
  }
  function applyMention(memberId) {
    const r = room();
    const m = memberOf(r, memberId);
    if (!m) return;
    const input = $('#message-input');
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret).replace(/@[^@\s]{0,20}$/, `@${m.role} `);
    input.value = before + input.value.slice(caret);
    r.draft.text = input.value;
    if (!r.draft.recipientIds.includes(memberId)) r.draft.recipientIds.push(memberId);
    closeMenu();
    renderComposer();
    input.focus();
    input.setSelectionRange(before.length, before.length);
  }

  // ---------- 弹窗 ----------
  const modal = $('#modal');
  const confirmation = document.createElement('dialog');
  confirmation.id = 'confirm-modal';
  document.body.append(confirmation);
  let returnFocus = null;
  let modalKind = '';
  let confirmReturn = null;
  let pendingConfirm = null;

  function openModal(kind, title, body, footer = '', focusSelector = '') {
    if (modal.open) modal.close(); // 重新打开时，close 事件的回调会因 modal.open 为真而跳过清理
    returnFocus = document.activeElement;
    modalKind = kind;
    modal.className = kind === 'artifact' ? 'dialog--wide' : '';
    modal.innerHTML = `<header class="modal-head"><h2 id="modal-title">${title}</h2>
      <button type="button" class="icon-button" data-action="modal-close" data-testid="modal-close" aria-label="关闭弹窗">${icon('close')}</button></header>
      ${body}${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}`;
    modal.showModal();
    (focusSelector ? $(focusSelector, modal) : $('input, textarea, button, select', modal))?.focus();
  }
  function closeModal() {
    if (modal.open) modal.close();
  }
  modal.addEventListener('close', () => {
    if (modal.open) return; // 已被新弹窗复用，不清空新内容
    modal.innerHTML = '';
    modalKind = '';
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  });
  // 弹窗内 Tab 循环，焦点不逃出当前对话框。
  modal.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusables = $$('button, input, textarea, select, a[href]', modal).filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  function confirmAction({ title, desc, confirmLabel, testid, onConfirm }) {
    pendingConfirm = onConfirm;
    confirmReturn = document.activeElement;
    confirmation.innerHTML = `<header class="modal-head"><h2 id="confirm-title">${title}</h2></header>
      <div class="modal-body"><p>${desc}</p></div>
      <footer class="modal-footer">
        ${btn('取消', 'confirm-cancel', '', 'data-testid="confirm-cancel"')}
        ${btn(confirmLabel, 'confirm-accept', 'danger', `data-testid="${testid}"`)}
      </footer>`;
    confirmation.showModal();
    $('[data-action="confirm-cancel"]', confirmation).focus();
  }
  function closeConfirm() {
    if (confirmation.open) confirmation.close();
  }
  confirmation.addEventListener('close', () => {
    confirmation.innerHTML = '';
    pendingConfirm = null;
    if (confirmReturn?.isConnected) confirmReturn.focus();
    confirmReturn = null;
  });

  // ---------- 流程：房间 / 成员 ----------
  function newRoomDialog() {
    openModal('new-room', '新建房间', `
      <form data-form="new-room">
        <div class="modal-body">
          <p class="notice">房间是常驻的协作组：先建房间、拉成员，之后随时把任务发给他们。以下为合成演示。</p>
          <div class="field"><label for="room-name">房间名称</label>
            <input id="room-name" type="text" data-testid="room-name" maxlength="40" placeholder="例如：登录体验小组"></div>
          <p class="form-error" data-testid="form-error" role="alert"></p>
        </div>
        <footer class="modal-footer">
          ${btn('取消', 'modal-close')}
          <button type="submit" class="button button--primary" data-testid="room-create">创建房间</button>
        </footer>
      </form>`, '', '#room-name');
  }
  function submitNewRoom(form) {
    const name = form.querySelector('#room-name').value.trim();
    const error = form.querySelector('[data-testid="form-error"]');
    if (!name) { error.textContent = '房间名称为必填。'; return; }
    const roomId = uid('r');
    state.rooms.push({
      id: roomId, name,
      members: [],
      messages: [{ id: uid('msg'), at: Date.now(), kind: 'system', text: CREATE_NOTE }],
      tasks: [], artifacts: [], decisions: [],
      draft: { text: '', recipientIds: [], quoteId: null },
    });
    state.roomId = roomId;
    state.view = 'discussion';
    closeModal();
    render();
    toast('房间已创建（合成演示，刷新后重置）');
  }

  function uniqueRoleName(r, base) {
    const taken = new Set(r.members.map(m => m.role));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }
  function addMemberDialog({ agentId = null, roleBase = '', duty = '' } = {}) {
    const r = room();
    openModal('add-member', '添加房间成员', `
      <form data-form="add-member">
        <div class="modal-body">
          <p class="notice">同一个 Agent 可以反复添加，每次都会生成独立成员与独立会话标识。Agent 均为配置名称，不代表本机安装状态。</p>
          <div class="field"><label>选择 Agent</label>
            <div class="radio-list">${AGENTS.map(a => `<label class="radio-card">
              <input type="radio" name="agent" value="${a.id}" data-testid="agent-option" ${(agentId ? a.id === agentId : a.id === AGENTS[0].id) ? 'checked' : ''}>
              <span class="radio-body"><span class="radio-title">${esc(a.name)}</span><span class="radio-sub">${esc(a.note)}</span></span>
              <span class="used">本房间已用 ${r.members.filter(m => m.agentId === a.id).length} 次</span>
            </label>`).join('')}</div></div>
          <div class="field"><label for="member-role">角色名称</label>
            <input id="member-role" type="text" data-testid="member-role" maxlength="24" placeholder="例如：接口实现" value="${esc(roleBase)}"></div>
          <div class="field"><label for="member-duty">职责</label>
            <input id="member-duty" type="text" data-testid="member-duty" maxlength="60" placeholder="一句话说明这位角色负责什么" value="${esc(duty)}"></div>
          <p class="form-error" data-testid="form-error" role="alert"></p>
        </div>
        <footer class="modal-footer">
          ${btn('取消', 'modal-close')}
          <button type="submit" class="button button--primary" data-testid="member-add">添加独立成员</button>
        </footer>
      </form>`, '', '#member-role');
  }
  function submitAddMember(form) {
    const r = room();
    const agentId = form.querySelector('input[name="agent"]:checked').value;
    const roleRaw = form.querySelector('#member-role').value.trim();
    const duty = form.querySelector('#member-duty').value.trim() || '（未填写职责）';
    const error = form.querySelector('[data-testid="form-error"]');
    if (!roleRaw) { error.textContent = '角色名称为必填。'; return; }
    const role = uniqueRoleName(r, roleRaw);
    const member = { memberId: uid('m'), agentId, role, duty, session: uid('sess') };
    r.members.push(member);
    addSys(r, `「${role}」以 ${agentOf(agentId).name} 加入房间（合成成员，独立会话标识 ${member.session}）`);
    closeModal();
    render();
    toast(role === roleRaw ? `已添加成员「${role}」（合成）` : `角色同名，自动记为「${role}」（合成）`);
  }

  function memberDialog(memberId) {
    const r = room();
    const m = memberOf(r, memberId);
    if (!m) return;
    const agent = agentOf(m.agentId);
    const tasks = r.tasks.filter(t => t.owners.includes(memberId));
    openModal('member', '成员详情', `
      <div class="modal-body">
        <div class="msg" style="padding-top:0">
          <span class="msg__avatar">${esc(initial(m.role))}</span>
          <div><div class="msg__head"><span class="msg__author">${esc(m.role)}</span><span class="msg__source">${esc(agent.name)}</span></div>
          <p class="msg__body">${esc(m.duty)}</p></div>
        </div>
        <dl class="detail-list">
          <dt>Agent</dt><dd>${esc(agent.name)} · ${esc(agent.note)}<br><small class="run-card__meta">配置名称，不代表本机安装状态；成员不配置模型。</small></dd>
          <dt>成员标识</dt><dd class="mono">${esc(m.memberId)}</dd>
          <dt>独立会话</dt><dd class="mono">${esc(m.session)}（合成）</dd>
        </dl>
        <div class="insp-label" style="margin-top:14px"><span>负责的任务</span></div>
        ${tasks.length
          ? `<div class="mini-task-list">${tasks.map(t => `<div class="mini-task"><span>${esc(t.title)}</span>${taskChip(t.state)}</div>`).join('')}</div>`
          : '<p class="run-card__meta" style="margin:0">暂未负责任务。</p>'}
      </div>
      <footer class="modal-footer modal-footer--split">
        <div class="run-controls">
          ${btn(`${icon('reply')}派任务给他`, 'mention-member', '', `data-testid="mention-member" data-member-id="${m.memberId}"`)}
          ${btn(`${icon('copy')}复制标识`, 'copy-member', '', `data-testid="copy-member" data-member-id="${m.memberId}"`)}
          ${btn(`${icon('plus')}再添加一位`, 'duplicate-member', '', `data-testid="duplicate-member" data-member-id="${m.memberId}"`)}
        </div>
        ${btn('关闭', 'modal-close')}
      </footer>`);
  }
  function mentionMember(memberId) {
    const r = room();
    const m = memberOf(r, memberId);
    if (!m) return;
    closeModal();
    const prefix = `@${m.role} `;
    if (!r.draft.text.startsWith(prefix)) r.draft.text = prefix + r.draft.text;
    if (!r.draft.recipientIds.includes(memberId)) r.draft.recipientIds.push(memberId);
    state.view = 'discussion';
    render();
    const input = $('#message-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  function copyMember(memberId) {
    const r = room();
    const m = memberOf(r, memberId);
    if (!m) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(m.memberId).then(
        () => toast('成员标识已复制'),
        () => toast('复制失败，请手动选择标识'),
      );
    } else {
      toast('当前环境不支持自动复制，请手动选择标识');
    }
  }
  function duplicateMember(memberId) {
    const r = room();
    const m = memberOf(r, memberId);
    if (!m) return;
    closeModal();
    // 复制时用基础名，让「同名自动递增」继续沿用原序列（登录页实现 → 登录页实现 3）。
    addMemberDialog({ agentId: m.agentId, roleBase: m.role.replace(/ \d+$/, ''), duty: m.duty });
  }

  // ---------- 流程：讨论与派活 ----------
  function sendMessage() {
    const r = room();
    const text = r.draft.text.trim();
    if (!text) return;
    const recipients = r.draft.recipientIds.filter(id => memberOf(r, id));
    const message = { id: uid('msg'), at: Date.now(), kind: 'msg', author: 'user', text, recipientIds: recipients, quote: r.draft.quoteId ?? null, taskId: null };
    if (recipients.length) {
      // 选中了接收者：这条消息同时是一次派活，任务立即开始（合成推进）。
      const task = {
        id: uid('t'), title: summarize(text), text, owners: recipients,
        state: 'running', progress: 0, evidence: [], artifacts: [],
        acceptance: [`完成派活要求：${summarize(text)}`, '提交可检查的证据（合成示例）'],
        createdAt: Date.now(),
      };
      r.tasks.push(task);
      message.taskId = task.id;
    }
    r.messages.push(message);
    r.draft.text = '';
    r.draft.recipientIds = [];
    r.draft.quoteId = null;
    closeMenu();
    render();
    if (message.taskId) toast(`任务已派给 ${recipients.map(id => '@' + (memberOf(r, id)?.role ?? '')).join('、')}（合成推进）`);
  }

  // ---------- 流程：任务执行 / 验证 / 停止 ----------
  function pauseTask(taskId) {
    const r = room();
    const t = taskOf(r, taskId);
    if (!t || t.state !== 'running') return;
    t.state = 'paused';
    addSys(r, `已暂停「${t.title}」：进度冻结（合成）`);
    render();
    toast('任务已暂停，进度已冻结（合成）');
  }
  function resumeTask(taskId) {
    const r = room();
    const t = taskOf(r, taskId);
    if (!t || t.state !== 'paused') return;
    t.state = 'running';
    addSys(r, `已恢复「${t.title}」（合成）`);
    render();
    toast('任务已恢复（合成）');
  }
  function confirmStopTask(taskId) {
    const t = taskOf(room(), taskId);
    confirmAction({
      title: '停止这条任务？',
      desc: `「${t?.title ?? ''}」停止后不再推进；已提交的产物会保留在「产物」标签。`,
      confirmLabel: '停止任务',
      testid: 'confirm-stop',
      onConfirm: () => stopTask(taskId),
    });
  }
  function stopTask(taskId) {
    const r = room();
    const t = taskOf(r, taskId);
    if (!t) return;
    t.state = 'stopped';
    addSys(r, `「${t.title}」已停止；已提交的产物保留在「产物」标签（合成操作）`);
    render();
    if (modalKind === 'task') taskDialog(taskId);
    toast('任务已停止（合成）');
  }
  function submitTask(r, t) {
    t.state = 'submitted';
    t.progress = 100;
    const diff = {
      id: uid('a'), kind: 'diff', title: `${t.title} · 改动差异（合成）`, by: t.owners[0] ?? null, at: Date.now(), task: t.id,
      body: diffBody(t.id),
    };
    r.artifacts.push(diff);
    t.artifacts.push(diff.id);
    t.evidence = [
      '改动范围：与派活内容相关的实现（合成示例，未真实执行）',
      '自检结论：逐条对照验收条件，证据见关联差异产物',
    ];
    addSys(r, `「${t.title}」已提交待验证（合成证据，等待你确认）`);
  }
  function verifyTask(taskId) {
    const r = room();
    const t = taskOf(r, taskId);
    if (!t || t.state !== 'submitted') return;
    t.state = 'verified';
    const record = {
      id: uid('a'), kind: 'record', title: `${t.title} · 验证记录（合成）`, by: t.owners[0] ?? null, at: Date.now(), task: t.id,
      body: t.acceptance.map((a, i) => ({ text: a, note: `第 ${i + 1} 条：合成验证通过，证据见关联差异产物` })),
    };
    r.artifacts.push(record);
    t.artifacts.push(record.id);
    addSys(r, `「${t.title}」验证通过（合成记录），证据已归档到产物`);
    toast('任务验证通过，证据已归档（合成）');
    render();
    if (modalKind === 'task') taskDialog(t.id); // 打开着详情时同步刷新内容
  }

  function taskDialog(taskId) {
    const r = room();
    const t = taskOf(r, taskId);
    if (!t) return;
    const record = t.artifacts.map(id => r.artifacts.find(a => a.id === id)).find(a => a && a.kind === 'record');
    let actions = '';
    if (t.state === 'running') actions = `<div class="run-controls">${btn('暂停', 'run-pause', '', `data-testid="run-pause" data-task-id="${t.id}"`)}${btn('停止', 'run-stop', 'danger', `data-testid="run-stop" data-task-id="${t.id}"`)}</div>`;
    if (t.state === 'paused') actions = `<div class="run-controls">${btn('恢复', 'run-resume', 'primary', `data-testid="run-resume" data-task-id="${t.id}"`)}${btn('停止', 'run-stop', 'danger', `data-testid="run-stop" data-task-id="${t.id}"`)}</div>`;
    if (t.state === 'submitted') actions = `<div class="run-controls">${btn('验证通过', 'task-verify', 'primary', `data-testid="task-verify" data-task-id="${t.id}"`)}</div>
      <p class="run-card__meta" style="margin:8px 0 0">验证独立于提交：先检查证据，再决定是否通过。</p>`;
    if (t.state === 'verified') actions = `${record ? `<div class="run-controls">${btn('查看验证记录', 'open-artifact', '', `data-artifact-id="${record.id}"`)}</div>` : ''}
      <p class="run-card__meta" style="margin:8px 0 0">已通过验证；记录已归档到产物。</p>`;
    if (t.state === 'stopped') actions = '<p class="run-card__meta" style="margin:0">已停止；已提交的产物保留在「产物」标签。</p>';
    openModal('task', '任务详情', `
      <div class="modal-body">
        <div class="task-row__top"><span class="task-row__title">${esc(t.title)}</span>${taskChip(t.state)}</div>
        <p class="task-row__meta">${ownerStack(r, t.owners)} · 派发于 ${hhmm(t.createdAt)} · 产物 ${t.artifacts.length} 件</p>
        ${t.state !== 'stopped' ? progressHtml(t.state === 'verified' || t.state === 'submitted' ? 100 : t.progress) : ''}
        <div class="insp-label" style="margin-top:14px"><span>派活内容</span></div>
        <div class="insp-card">${esc(t.text)}</div>
        <div class="insp-label" style="margin-top:14px"><span>验收条件</span></div>
        <ul class="accept-list">${t.acceptance.map((a, i) => `<li><span class="idx">${pad(i + 1)}</span><span>${esc(a)}</span></li>`).join('')}</ul>
        <div class="insp-label" style="margin-top:14px"><span>证据</span></div>
        ${t.evidence.length
          ? `<ul class="evidence-list">${t.evidence.map(e => `<li><span class="bullet">·</span><span>${esc(e)}</span></li>`).join('')}</ul>`
          : '<p class="run-card__meta" style="margin:0">尚无证据；任务提交后在这里展示合成证据。</p>'}
        ${t.artifacts.length ? `<div class="insp-label" style="margin-top:14px"><span>关联产物</span></div>
          <div class="run-controls">${t.artifacts.map(id => {
            const a = r.artifacts.find(x => x.id === id);
            return a ? btn(`${icon(ARTIFACT_KIND[a.kind]?.icon ?? 'file')}${esc(a.title)}`, 'open-artifact', 'quiet', `data-artifact-id="${a.id}"`) : '';
          }).join('')}</div>` : ''}
      </div>
      <footer class="modal-footer modal-footer--split">
        <div class="run-controls">${actions}</div>
        ${btn('关闭', 'modal-close')}
      </footer>`);
  }

  function specHtml(blocks) {
    return `<div class="spec">${blocks.map(b => b.h ? `<h3>${esc(b.h)}</h3>` : b.p ? `<p>${esc(b.p)}</p>` : b.ul ? `<ul>${b.ul.map(li => `<li>${esc(li)}</li>`).join('')}</ul>` : '').join('')}</div>`;
  }
  function artifactDialog(artifactId) {
    const r = room();
    const a = r.artifacts.find(x => x.id === artifactId);
    if (!a) return;
    const meta = ARTIFACT_KIND[a.kind] ?? ARTIFACT_KIND.file;
    const body = a.kind === 'spec' ? specHtml(a.body)
      : a.kind === 'diff' ? `<pre class="diff">${a.body.map(line => `<span class="diff-${line.t}">${esc(line.v)}</span>\n`).join('')}</pre>`
      : `<ul class="record-list">${a.body.map(item => `<li>${icon('check')}<span>${esc(item.text)}<small>${esc(item.note)}</small></span></li>`).join('')}</ul>`;
    const from = a.task ? taskOf(r, a.task) : null;
    openModal('artifact', `${meta.label} · ${esc(a.title)}`, `
      <div class="modal-body">
        <p class="notice">合成示例产物：用于表达交付形态，不代表真实执行结果。</p>
        ${body}
      </div>
      <footer class="modal-footer">
        ${from ? btn('打开来源任务', 'open-task', '', `data-task-id="${from.id}"`) : ''}
        ${btn('关闭', 'modal-close')}
      </footer>`);
  }

  // ---------- 流程：显示设置 ----------
  function designDialog() {
    openModal('design', '显示设置', `
      <div class="modal-body">
        <div class="field"><label>布局</label>
          <div class="radio-list">${[
            ['balanced', '标准协作', '三栏并列：房间、讨论、任务与进展。'],
            ['focus', '专注讨论', '收起右栏、限制正文行宽，适合长讨论。'],
            ['compact', '紧凑工作', '缩小间距、展示更多内容；正文字号不缩。'],
          ].map(([value, title, sub]) => `<label class="radio-card">
            <input type="radio" name="layout" value="${value}" data-testid="layout-option" ${state.layout === value ? 'checked' : ''}>
            <span class="radio-body"><span class="radio-title">${title}</span><span class="radio-sub">${sub}</span></span>
          </label>`).join('')}</div></div>
        <div class="field"><label>主题</label>
          <div class="radio-list">${[
            ['dark', '深色 · Graphite'],
            ['light', '浅色 · 暖白'],
          ].map(([value, title]) => `<label class="radio-card">
            <input type="radio" name="theme" value="${value}" data-testid="theme-option" ${state.theme === value ? 'checked' : ''}>
            <span class="radio-body"><span class="radio-title">${title}</span></span>
          </label>`).join('')}</div></div>
        <p class="run-card__meta" style="margin:0">原型状态只保存在当前页面内存中；刷新后重置。</p>
      </div>
      <footer class="modal-footer">${btn('完成', 'modal-close')}</footer>`);
  }
  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
  }
  function setLayout(layout) {
    state.layout = layout;
    document.documentElement.dataset.layout = layout;
    if (layout !== 'focus') closeAllDrawers(); // 离开专注布局时收回右栏抽屉，避免遮罩空挂
    render();
  }

  // ---------- 视图与搜索 ----------
  function setView(view) {
    state.view = view;
    renderTabs();
    renderContent();
  }
  function openSearch() {
    $('#search-bar').hidden = false;
    $('#message-search').focus();
  }
  function closeSearch() {
    $('#search-bar').hidden = true;
    state.search = '';
    $('#message-search').value = '';
    renderContent();
  }

  // ---------- 事件绑定 ----------
  document.addEventListener('submit', event => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === 'new-room') submitNewRoom(form);
    if (form.dataset.form === 'add-member') submitAddMember(form);
  });

  document.addEventListener('change', event => {
    if (event.target.matches('[data-testid="layout-option"]')) setLayout(event.target.value);
    if (event.target.matches('[data-testid="theme-option"]')) setTheme(event.target.value);
  });

  document.addEventListener('click', event => {
    const actionEl = event.target.closest('[data-action]');
    const msgAction = event.target.closest('[data-msg-action]');
    if (msgAction) {
      const r = room();
      const msg = r.messages.find(m => m.id === msgAction.dataset.msgId);
      if (msg && msgAction.dataset.msgAction === 'quote') {
        r.draft.quoteId = msg.id;
        renderComposer();
        $('#message-input').focus();
      } else if (msg && msgAction.dataset.msgAction === 'decision') {
        r.decisions.push({ id: uid('d'), by: msg.author, text: msg.text, at: Date.now() });
        r.messages.push({ id: uid('msg'), at: Date.now(), kind: 'decision', author: msg.author, text: msg.text });
        render();
        toast('已标记为决定（合成）');
      }
      return;
    }
    if (actionEl) {
      const r = room();
      switch (actionEl.dataset.action) {
        case 'theme': setTheme(state.theme === 'dark' ? 'light' : 'dark'); break;
        case 'design': designDialog(); break;
        case 'new-room': newRoomDialog(); break;
        case 'add-member': addMemberDialog(); break;
        case 'close-drawers': closeAllDrawers(); break;
        case 'sidebar': toggleDrawer('sidebar'); break;
        case 'inspector': toggleInspector(); break;
        case 'search': if ($('#search-bar').hidden) openSearch(); else closeSearch(); break;
        case 'close-search': closeSearch(); break;
        case 'recipients': toggleRecipientsMenu(); break;
        case 'close-menu': closeMenu(); break;
        case 'toggle-recipient': {
          const memberId = actionEl.dataset.memberId;
          const index = r.draft.recipientIds.indexOf(memberId);
          if (index >= 0) r.draft.recipientIds.splice(index, 1);
          else r.draft.recipientIds.push(memberId);
          closeMenu();
          toggleRecipientsMenu(); // 重开菜单以刷新勾选状态
          renderComposer();
          break;
        }
        case 'cancel-quote': r.draft.quoteId = null; renderComposer(); break;
        case 'modal-close': closeModal(); break;
        case 'pick-mention': applyMention(actionEl.dataset.memberId); break;
        case 'run-pause': pauseTask(actionEl.dataset.taskId); break;
        case 'run-resume': resumeTask(actionEl.dataset.taskId); break;
        case 'run-stop': confirmStopTask(actionEl.dataset.taskId); break;
        case 'confirm-cancel': closeConfirm(); break;
        case 'confirm-accept': { const run = pendingConfirm; closeConfirm(); run?.(); break; }
        case 'mention-member': mentionMember(actionEl.dataset.memberId); break;
        case 'copy-member': copyMember(actionEl.dataset.memberId); break;
        case 'duplicate-member': duplicateMember(actionEl.dataset.memberId); break;
        case 'task-verify': verifyTask(actionEl.dataset.taskId); break;
        case 'open-task': taskDialog(actionEl.dataset.taskId); break;
        case 'open-artifact': artifactDialog(actionEl.dataset.artifactId); break;
        default: break;
      }
      return;
    }
    const quoteEl = event.target.closest('[data-quote-id]');
    if (quoteEl) {
      const target = document.querySelector(`[data-msg-id="${quoteEl.dataset.quoteId}"]`);
      target?.scrollIntoView({ block: 'center' });
      target?.classList.add('msg--flash');
      setTimeout(() => target?.classList.remove('msg--flash'), 1700);
      return;
    }
    const roomEl = event.target.closest('[data-room-id]');
    if (roomEl) { switchRoom(roomEl.dataset.roomId); return; }
    const memberEl = event.target.closest('[data-member-id]');
    if (memberEl) { memberDialog(memberEl.dataset.memberId); return; }
    const taskEl = event.target.closest('[data-task-id]');
    if (taskEl) { taskDialog(taskEl.dataset.taskId); return; }
    const artifactEl = event.target.closest('[data-artifact-id]');
    if (artifactEl) { artifactDialog(artifactEl.dataset.artifactId); return; }
    // 菜单的点击外关闭放在最后：点击菜单项本身已在上面处理并 return。
    if (state.menu && !event.target.closest('.menu') && !event.target.closest('#recipient-button')) closeMenu();
  });

  function switchRoom(roomId) {
    if (!state.rooms.some(r => r.id === roomId)) return;
    state.roomId = roomId;
    state.search = '';
    $('#message-search').value = '';
    $('#search-bar').hidden = true;
    closeMenu();
    closeAllDrawers();
    render();
  }

  $('.tabs').addEventListener('click', event => {
    const tab = event.target.closest('[data-view]');
    if (tab) setView(tab.dataset.view);
  });
  $('.tabs').addEventListener('keydown', event => {
    const tabs = $$('[role="tab"]', event.currentTarget);
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs[tabs.length - 1];
    if (next) { event.preventDefault(); next.focus(); setView(next.dataset.view); }
  });

  $('#message-search').addEventListener('input', event => {
    state.search = event.target.value;
    if (state.view !== 'discussion') setView('discussion');
    else renderContent();
  });

  const messageInput = $('#message-input');
  let composing = false;
  messageInput.addEventListener('compositionstart', () => { composing = true; });
  messageInput.addEventListener('compositionend', () => { composing = false; });
  messageInput.addEventListener('input', () => {
    const r = room();
    r.draft.text = messageInput.value;
    $('#send-message').disabled = !messageInput.value.trim();
    autosize(messageInput);
    updateMentionMenu();
  });
  messageInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    if (event.isComposing || composing) return; // 中文输入法组合态不发送
    if (event.shiftKey) return; // 换行交给默认行为
    if (state.menu === 'mentions') {
      event.preventDefault();
      const first = $('#mentions-menu .menu__item');
      if (first) applyMention(first.dataset.memberId);
      return;
    }
    event.preventDefault();
    sendMessage();
  });
  $('#composer').addEventListener('submit', event => {
    event.preventDefault();
    sendMessage();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (modal.open || confirmation.open) return; // 原生 dialog 自己处理
    if (state.menu) { closeMenu(); return; }
    if (state.drawer) { closeAllDrawers(); }
  });

  // ---------- 示例时钟与测试钩子 ----------
  function step(n = 1) {
    for (let i = 0; i < n; i++) {
      state.clock += 1;
      for (const r of state.rooms) {
        for (const t of r.tasks) {
          if (t.state !== 'running') continue;
          t.progress = Math.min(100, t.progress + 10);
          if (t.progress >= 100) submitTask(r, t);
        }
      }
    }
    render();
  }

  const autoParam = new URLSearchParams(location.search).get('auto');
  state.auto = autoParam !== '0';
  window.setInterval(() => { if (state.auto) step(); }, 700);

  window.belfryRoom = {
    get state() {
      return JSON.parse(JSON.stringify({
        theme: state.theme, layout: state.layout, view: state.view, search: state.search,
        drawer: state.drawer, roomId: state.roomId, clock: state.clock, rooms: state.rooms,
      }));
    },
    step,
    setAuto(value) { state.auto = Boolean(value); },
  };

  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.layout = state.layout;
  render();
})();
