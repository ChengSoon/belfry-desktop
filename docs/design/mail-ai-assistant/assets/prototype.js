/* 本地交互视图。生产接入前按 ui-design.md 的映射替换内存动作。 */
(() => {
  'use strict';
  const D = window.MailDemoData;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const labels = { connected: '连接正常', untested: '未测试', auth_required: '授权失效', error: '连接异常', queued: '排队中', running: '运行中', waiting_retry: '等待重试', succeeded: '成功', partial: '部分完成', failed: '失败', cancelled: '已取消', ready: '已生成', edited: '已编辑', expired: '内容已过期' };
  const tone = state => ['connected', 'succeeded', 'ready', 'edited'].includes(state) ? 'success' : ['auth_required', 'error', 'failed'].includes(state) ? 'danger' : ['partial', 'waiting_retry'].includes(state) ? 'warning' : ['queued', 'running'].includes(state) ? 'info' : '';
  const pill = (text, type = '') => '<span class="pill ' + type + '">' + esc(text) + '</span>';
  const status = value => '<span class="pill ' + tone(value) + '"><span class="status-dot"></span>' + esc(labels[value] || value) + '</span>';
  const button = (text, action, id = '', style = '', extra = '') => '<button type="button" class="button ' + style + '" data-action="' + action + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + ' ' + extra + '>' + esc(text) + '</button>';
  const fmt = (date, full = false) => date ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...(full ? { month: '2-digit', day: '2-digit' } : {}), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date)) : '尚未运行';
  const providerLogo = provider => { const p = D.providers[provider]; return '<span class="provider-logo">' + (p.image ? '<img src="' + p.image + '" alt="' + esc(p.name) + ' 标志" width="25" height="25">' : '<span aria-hidden="true">@</span>') + '</span>'; };
  const template = id => D.templates.find(t => t.id === id);
  const ui = window.MailUI = {
    D, esc, pill, status, button, fmt, providerLogo, template,
    state: D.seed(), view: 'results', configTab: 'mailboxes', selectedResultId: 'res_summary', readingTab: 'result', mobileDetail: false,
    resultFilter: { mailboxId: '', template: '', taskId: '', time: '' }, runFilter: { kind: '', mailboxId: '', status: '' },
    editors: {}, timers: new Set(), generation: 0, modal: null, toastTimer: null, forceConflict: false,
    account(id) { return this.state.mailboxes.find(m => m.id === id); },
    task(id) { return this.state.tasks.find(t => t.id === id); },
    message(id) { return this.state.messages.find(m => m.id === id); },
    result(id) { return this.state.results.find(r => r.id === id); },
    run(id) { return this.state.runs.find(r => r.id === id); },
    id(prefix) { return prefix + '_demo_' + (++this.state.counter); },
    now(seconds = 1) { this.state.clock = new Date(new Date(this.state.clock).getTime() + seconds * 1000).toISOString(); return this.state.clock; },
    later(seconds) { return new Date(new Date(this.state.clock).getTime() + seconds * 1000).toISOString(); },
    defer(fn, ms) { const generation = this.generation; const timer = setTimeout(() => { this.timers.delete(timer); if (generation === this.generation) fn(); }, ms); this.timers.add(timer); return timer; },
    toast(text) { const target = document.querySelector('#toast'); clearTimeout(this.toastTimer); target.textContent = text; target.classList.add('visible'); this.toastTimer = setTimeout(() => target.classList.remove('visible'), 3600); },
    pendingRuns() { return this.state.runs.filter(r => ['failed', 'partial'].includes(r.status)); },
    version(taskId, versionId) { return this.task(taskId)?.versions.find(v => v.id === versionId); },
    editor(result) { if (!this.editors[result.id]) this.editors[result.id] = { subject: result.draft.subject, bodyText: result.draft.bodyText, revision: result.revision, dirty: false, conflict: false }; return this.editors[result.id]; }
  };
  ui.shell = function(content) {
    const failures = this.pendingRuns().length;
    const scenarios = { daily: '日常工作', empty: '从零开始', auth: '授权失效', sync_failure: '同步失败', task_failure: '单任务失败', waiting: '等待自动重试', no_new: '没有新邮件', recovery: '邮件身份待确认', draft_conflict: '草稿编辑冲突' };
    return `<div class="demo-banner"><span><strong>交互原型 · 演示数据</strong>　未连接真实邮箱或 AI 服务</span><span class="mono">DESIGN PREVIEW / M1 → M2</span></div>
      <div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark" aria-hidden="true">信</div><div><div class="brand-title">邮件 AI 助手</div><div class="brand-caption">MAIL · WITH CONTEXT</div></div></div>
      <nav class="primary-nav" aria-label="主要导航">${[['config','01','配置'],['results','02','处理结果'],['runs','03','运行记录']].map(([view,n,name]) => `<a href="#${view}" data-action="navigate" data-view="${view}" class="nav-item" ${this.view === view ? 'aria-current="page"' : ''}><span class="nav-number">${n}</span>${name}${view === 'results' ? `<span class="nav-count">${this.state.results.length}</span>` : view === 'runs' && failures ? `<span class="nav-count">${failures}</span>` : ''}</a>`).join('')}</nav>
      <p class="sidebar-caption">从一封来信，<br>到清楚的下一步。</p><div class="sidebar-footer"><label class="scenario-label" for="demo-scenario">演示情境</label><select id="demo-scenario" aria-label="切换演示情境">${Object.entries(scenarios).map(([id,name])=>`<option value="${id}" ${this.state.scenario === id ? 'selected' : ''}>${name}</option>`).join('')}</select>
      <details class="demo-controls"><summary>演示选项</summary><div class="field"><label for="appearance">阅读外观</label><select id="appearance"><option value="paper">暖白 · 标准</option><option value="graphite">石墨 · 夜间</option><option value="compact">暖白 · 紧凑</option></select></div><div class="field"><label for="test-outcome">下一次邮箱测试</label><select id="test-outcome"><option value="success">模拟成功</option><option value="auth">模拟认证失败</option><option value="network">模拟网络失败</option></select></div><p class="small muted">切换情境或刷新会重置演示。所有能力均待真实实现与验证。</p>${button('重置当前情境','reset','','small')} ${this.state.scenario === 'waiting' ? button('推进到重试时间','advance-retry','','small') : ''}</details></div></aside>
      <main id="main" class="workspace" tabindex="-1"><div class="topline"><span><span class="dot"></span>个人工作空间 <span class="muted">/ 模拟运行</span></span><span class="mono">10.29 · ${fmt(this.state.clock)} · 上海</span></div>${content}</main></div>`;
  };
  ui.heading = (kicker, title, description, action = '') => `<header class="page-heading"><div><div class="eyebrow">${esc(kicker)}</div><h1 id="page-title" tabindex="-1">${esc(title)}</h1><p>${esc(description)}</p></div>${action}</header>`;
  ui.future = () => `<div class="future-row" aria-label="后续能力"><span class="future-item">日报与汇总报表 ${pill('M3 后续')}</span><span class="future-item">附件内容与 OCR ${pill('M3 后续')}</span><span class="future-item">历史导入 ${pill('M3 后续')}</span><span class="future-item">通知与邮件发送 ${pill('后续')}</span></div>`;
  ui.empty = (title, description, action, onboarding = false) => `<section class="empty-state"><div class="empty-mark" aria-hidden="true">信</div><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}${onboarding ? `<div class="setup-steps"><div class="setup-step"><div class="mono">01</div><strong>连接邮箱</strong><p>选择服务商，测试连接。</p></div><div class="setup-step"><div class="mono">02</div><strong>安排 AI 任务</strong><p>配置服务与需要的处理方式。</p></div><div class="setup-step"><div class="mono">03</div><strong>接收第一份结果</strong><p>立即检查，核对结果与原文。</p></div></div>` : ''}</section>`;
  ui.configPage = function() {
    const tab = this.configTab;
    const tabs = [['mailboxes','邮箱连接',this.state.mailboxes.length],['tasks','AI 任务',this.state.tasks.length],['services','AI 服务',this.state.services.length]];
    let body = this.heading('Configuration','配置','连接邮箱，安排每封新邮件要做的事。',button(tab === 'mailboxes' ? '＋ 连接邮箱' : tab === 'tasks' ? '＋ 新建任务' : '＋ 配置 AI 服务',tab === 'mailboxes' ? 'new-mailbox' : tab === 'tasks' ? 'new-task' : 'new-service','','primary'));
    body += `<div class="tabs" role="tablist" aria-label="配置类型">${tabs.map(([id,name,count])=>`<button class="tab" role="tab" id="config-${id}" aria-selected="${tab === id}" aria-controls="config-panel" tabindex="${tab === id ? 0 : -1}" data-action="config-tab" data-id="${id}">${name}<span class="count">${count}</span></button>`).join('')}</div><section id="config-panel" role="tabpanel" aria-labelledby="config-${tab}">`;
    if (tab === 'mailboxes') body += this.mailboxesPage();
    if (tab === 'tasks') body += this.tasksPage();
    if (tab === 'services') body += this.servicesPage();
    return body + '</section>' + this.future();
  };
  ui.mailboxesPage = function() {
    if (!this.state.mailboxes.length) return this.empty('让第一封邮件开始流动','先连接一个演示邮箱，再选择 AI 任务。你可以随时暂停定时检查。',button('连接第一个邮箱','new-mailbox','','primary'),true);
    return `<div class="account-grid">${this.state.mailboxes.map(m => {
      const p = D.providers[m.provider];
      const busy = this.run(m.activeSyncRunId);
      const issue = m.connectionState === 'auth_required';
      return `<article class="panel account-card" data-mailbox-id="${m.id}"><div class="row align-start">${providerLogo(m.provider)}<div class="account-identity grow"><h3>${esc(m.name)}</h3><p>${esc(m.accountEmail)}</p></div>${pill(p.stage + ' 演示','outline')}</div>
      <div class="account-status">${status(m.connectionState)}<div class="switch-label"><span>定时检查</span><button class="switch" role="switch" aria-label="${esc(m.name)}定时检查" aria-checked="${m.syncPolicy.enabled}" data-action="toggle-sync" data-id="${m.id}"><span></span></button></div></div>
      <div class="meta-grid"><div><div class="meta-label">同步频率</div><div class="meta-value">每 ${m.syncPolicy.intervalSeconds / 60} 分钟 · 收件箱</div></div><div><div class="meta-label">下次计划检查</div><div class="meta-value">${!m.syncPolicy.enabled ? '已暂停定时' : m.nextSyncAt ? fmt(m.nextSyncAt) : issue ? '等待恢复授权' : '待安排'}</div></div><div><div class="meta-label">上次成功</div><div class="meta-value">${fmt(m.lastSuccessfulSyncAt)}</div></div><div><div class="meta-label">连接方式</div><div class="meta-value">${m.provider === 'imap' ? 'IMAP · TLS' : m.provider === 'gmail' ? 'Gmail API' : 'Microsoft Graph'}</div></div></div>
      ${m.lastError ? `<div class="notice account-error ${issue ? 'warning' : 'danger'}"><div class="grow"><p>${esc(m.lastError.message)}</p></div></div>` : ''}
      <div class="account-footer">${button('设置','mailbox-settings',m.id,'small')}${issue ? button('重新授权','reauthorize',m.id,'small primary') : busy && ['queued','running','waiting_retry'].includes(busy.status) ? button('查看运行','run-detail',busy.id,'small') : button('立即检查','sync-now',m.id,'small primary')}</div></article>`;
    }).join('')}</div><p class="section-note">连接状态和定时开关分别管理。暂停定时后仍可手动检查；只处理激活后收到的新邮件，已读邮件也会同步。</p><div class="quiet-note">原型模拟主流邮箱的接入流程。IMAP 为 M1 计划；Gmail、Microsoft 为 M2 计划，均尚未验证真实账号。</div>`;
  };
  ui.tasksPage = function() {
    if (!this.state.tasks.length) return this.empty('给新邮件安排一个任务','从摘要开始。一个邮箱可以绑定多个任务，每项任务独立运行。',button('创建第一个任务','new-task','','primary'));
    return `<div class="notice"><div class="grow"><div class="notice-title">配置一次，复用于多个邮箱</div><p class="muted">绑定只作用于此后新入库的邮件。保存新版本后，已有结果仍保留原来的版本。</p></div></div><div class="panel task-list">${this.state.tasks.map(t => {
      const tt = template(t.definition.template), bindings = this.state.bindings.filter(b => b.taskId === t.id && b.enabled);
      return `<article class="task-row" data-task-id="${t.id}"><div class="row"><span class="template-mark" aria-hidden="true">${tt.mark}</span><div><div class="task-name">${esc(t.name)}</div><div class="small muted">${tt.short} <span class="mono">· v${t.currentVersion.number}</span></div></div></div><div class="binding-list">${bindings.map(b => esc(this.account(b.mailboxId)?.name || '未知邮箱')).join('、') || '尚未绑定邮箱'}</div><div class="task-stage">${pill(tt.stage + ' 演示','outline')}</div><div class="row"><div class="switch-label"><span>${t.enabled ? '已启用' : '已暂停'}</span><button class="switch" role="switch" aria-label="${esc(t.name)}启用状态" aria-checked="${t.enabled}" data-action="toggle-task" data-id="${t.id}"><span></span></button></div>${button('编辑','edit-task',t.id,'small')}</div></article>`;
    }).join('')}</div><p class="section-note">停用只影响后续入库，已经排队的任务继续使用当时固定的版本。六类模板共用配置流程。</p>`;
  };
  ui.servicesPage = function() {
    if (!this.state.services.length) return this.empty('配置处理邮件的 AI 服务','填写演示服务与模型，测试成功后即可用于任务。',button('配置 AI 服务','new-service','','primary'));
    return this.state.services.map(service=>`<article class="panel"><div class="service-line"><div class="row align-start"><span class="provider-logo" aria-hidden="true">AI</span><div><h3>${esc(service.name)}</h3><div class="service-meta">${esc(service.baseUrl)}<br>模型：<span class="mono">${esc(service.defaultModel)}</span></div></div><div class="row wrap">${status(service.connectionState)}${button('模拟测试','test-service',service.id,'small')}${button('设置','edit-service',service.id,'small')}</div></div><div class="service-details"><div class="meta-grid"><div><div class="meta-label">连接测试</div><div class="meta-value">${fmt(service.lastTestedAt)} · 固定短样本</div></div><div><div class="meta-label">凭据</div><div class="meta-value">演示占位符 · 不读取真实密钥</div></div></div><p class="section-note">更改服务或模型配置会产生新配置版本；任务采用新配置时，需要保存一个新的任务版本。</p></div></article>`).join('');
  };
  ui.filteredResults = function() {
    const f = this.resultFilter;
    return this.state.results.filter(r => r.status !== 'expired' && (!f.mailboxId || r.mailboxId === f.mailboxId) && (!f.template || r.template === f.template) && (!f.taskId || r.taskId === f.taskId) && (!f.time || r.createdAt.slice(0,10) === this.state.clock.slice(0,10)));
  };
  ui.preview = r => {
    if (!r.output) return '内容已过期';
    if (r.template === 'summary') return r.output.summary;
    if (r.template === 'classification') return (r.output.category || '未分类') + ' · ' + r.output.reason;
    if (r.template === 'todo_extraction') return r.output.items.length ? r.output.items.map(i=>i.text).join('；') : '没有明确的待办事项';
    if (r.template === 'field_extraction') return Object.entries(r.output.fields).map(([key,value]) => key + '：' + (value ?? '未提供')).join(' · ');
    if (r.template === 'translation') return r.output.translatedText;
    return r.draft?.bodyText || r.output.bodyText;
  };
  ui.resultsPage = function() {
    const rows = this.filteredResults(), failureCount = this.state.runs.filter(r => r.kind === 'ai' && r.status === 'failed').length;
    if (!rows.some(r => r.id === this.selectedResultId)) this.selectedResultId = rows[0]?.id || null;
    const selected = this.result(this.selectedResultId);
    let html = this.heading('Results · Made readable','处理结果','读重点，也看得见它从哪里来。',button('立即运行','run-picker','','primary'));
    html += `<div class="results-heading-meta"><span><strong>${this.state.results.length}</strong> 条已生成结果</span><span><strong>${this.state.mailboxes.length}</strong> 个邮箱</span><span>示例日期 <strong>10.29</strong></span></div>`;
    if (failureCount) html += `<div class="notice warning"><span class="notice-symbol" aria-hidden="true">!</span><div class="grow"><div class="notice-title">${failureCount} 项 AI 任务需要处理</div><p>其他结果已保留，可以单独重试失败任务。</p></div>${button('查看失败任务','show-ai-failures','','small')}</div>`;
    html += `<div class="filter-bar" aria-label="结果筛选"><div class="field"><label for="result-mailbox">邮箱</label><select id="result-mailbox" data-filter="mailboxId"><option value="">全部邮箱</option>${this.state.mailboxes.map(m=>`<option value="${m.id}" ${this.resultFilter.mailboxId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div><div class="field"><label for="result-template">任务类型</label><select id="result-template" data-filter="template"><option value="">全部类型</option>${D.templates.map(t=>`<option value="${t.id}" ${this.resultFilter.template === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div><div class="field wide"><label for="result-task">AI 任务</label><select id="result-task" data-filter="taskId"><option value="">全部任务</option>${this.state.tasks.map(t=>`<option value="${t.id}" ${this.resultFilter.taskId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div><div class="field"><label for="result-time">生成时间</label><select id="result-time" data-filter="time"><option value="">全部时间</option><option value="today" ${this.resultFilter.time ? 'selected' : ''}>演示当天</option></select></div></div>`;
    if (!rows.length) return html + (this.state.results.length ? this.empty('没有符合筛选的结果','试试其他邮箱或任务类型。',button('清除筛选','clear-result-filters')) : this.empty('第一份结果，还在路上',this.state.mailboxes.length ? '配置任务后立即检查。没有新邮件的检查会在运行记录中显示成功。' : '连接邮箱并安排 AI 任务后，结果会集中出现在这里。',button(this.state.mailboxes.length ? '查看配置' : '连接第一个邮箱',this.state.mailboxes.length ? 'go-config' : 'new-mailbox','','primary')));
    return html + `<div class="results-layout ${this.mobileDetail ? 'has-mobile-detail' : ''}"><section class="result-list" aria-label="结果列表"><div class="result-list-header"><span>最近生成</span><span class="mono">${rows.length} 条</span></div>${rows.map(r=>`<button type="button" class="result-row" data-action="select-result" data-id="${r.id}" aria-pressed="${r.id === this.selectedResultId}"><div class="row between">${pill(template(r.template).name)}<span class="small muted">${fmt(r.createdAt)}</span></div><div class="result-row-title">${esc(this.message(r.messageId)?.subject || '原邮件已过期')}</div><p class="result-row-preview">${esc(this.preview(r))}</p><div class="result-row-source"><span>${esc(this.account(r.mailboxId)?.name)}</span><span>v${this.version(r.taskId,r.taskVersionId)?.number || 1} · ${labels[r.status]}</span></div></button>`).join('')}</section><div class="detail-column">${button('← 返回结果列表','back-results','','ghost mobile-back')}<article class="reading-desk mobile-active" aria-label="选中的结果详情">${this.resultDetail(selected)}</article></div></div>`;
  };
  ui.source = function(message, standalone = false) {
    if (!message || message.contentState !== 'available') return `<div class="quiet-note">原邮件正文不可用，无法再执行 AI 任务。</div>`;
    return `<details class="source-card" ${standalone ? 'data-standalone="true"' : ''} open><summary>原邮件 · 对照阅读</summary><div class="source-content"><dl class="source-envelope"><dt>发件人</dt><dd>${esc(message.from.name)} &lt;${esc(message.from.address)}&gt;</dd><dt>收件箱</dt><dd>${esc(this.account(message.mailboxId)?.name)}</dd><dt>收到于</dt><dd>${fmt(message.receivedAt,true)}</dd></dl><div class="source-body">${esc(message.bodyText)}</div>${message.attachments.map(a=>`<div class="attachment"><span>${esc(a.filename)}<br><span class="muted">${a.sizeBytes === null ? '大小未知' : Math.round(a.sizeBytes / 1024) + ' KB'} · 仅元数据</span></span>${pill('内容处理 · 后续')}</div>`).join('')}</div></details>`;
  };
  ui.output = function(result, isPreview = false) {
    const o = result.output, type = result.template;
    if (!o) return '<div class="quiet-note">结果内容已按保留策略清理。</div>';
    let content = '';
    if (type === 'summary') content = `<div class="output-kicker">The essentials</div><p>${esc(o.summary)}</p><h3>值得留意</h3><ul class="key-points">${o.keyPoints.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`;
    if (type === 'classification') content = `<div class="output-kicker">分类结果</div>${pill(o.category || '未分类','success')}<p class="small muted">${o.confidence === null ? '置信度未提供' : '模型置信度 ' + Math.round(o.confidence * 100) + '% · 供参考'}</p><h3>分类依据</h3><p>${esc(o.reason)}</p>`;
    if (type === 'todo_extraction') content = `<div class="output-kicker">${o.items.length} 项明确行动</div>` + (o.items.length ? o.items.map((item,index)=>`<div class="todo-item"><div class="row align-start"><span class="todo-index">${index + 1}</span><div class="grow"><strong>${esc(item.text)}</strong><div class="todo-meta"><span>负责人：${esc(item.owner ?? '未提供')}</span><span>截止：${esc(item.dueDate ?? '未提供')}</span></div>${item.sourceQuote ? `<p class="source-quote">原文：「${esc(item.sourceQuote)}」</p>` : ''}</div></div></div>`).join('') : '<p>这封邮件没有明确的待办事项。</p>');
    if (type === 'field_extraction') content = `<div class="output-kicker">结构化字段</div><table class="field-table"><tbody>${Object.entries(o.fields).map(([key,value])=>`<tr><th scope="row">${esc(key)}</th><td>${value === null ? '<span class="muted">未提供</span>' : esc(value)}</td></tr>`).join('')}</tbody></table><p class="small muted">未找到的字段保留为空。</p>`;
    if (type === 'translation') content = `<div class="output-kicker">译文 · ${esc(o.targetLanguage)}</div><p class="source-body">${esc(o.translatedText)}</p>`;
    if (type === 'reply_draft') {
      if (isPreview) content = `<h3>${esc(o.subject)}</h3><p class="source-body">${esc(o.bodyText)}</p>`;
      else {
        const edit = this.editor(result);
        content = `<div class="output-kicker">回复草稿 · 由你最后确认</div><div class="stack"><div class="field"><label for="draft-subject">主题</label><input id="draft-subject" data-draft-field="subject" data-result-id="${result.id}" value="${esc(edit.subject)}"></div><div class="field"><label for="draft-body">正文</label><textarea id="draft-body" data-draft-field="bodyText" data-result-id="${result.id}" rows="7">${esc(edit.bodyText)}</textarea></div><p id="draft-status" class="draft-status">${edit.dirty ? '有未保存的修改' : result.status === 'edited' ? '修改已保存，模型原输出仍保留' : '模型原稿 · 可以编辑后保存'}</p>${edit.conflict ? `<div class="conflict-panel" role="alert"><p>此草稿已在另一处更新。你的文字已保留，请比较后继续编辑。</p><details><summary>查看最新保存内容</summary><div class="conflict-server">${esc(result.draft.subject)}\n\n${esc(result.draft.bodyText)}</div></details><div class="row wrap">${button('保留我的文字继续编辑','resolve-draft-conflict',result.id,'small')}${button('采用最新保存内容','reload-draft',result.id,'small')}</div></div>` : ''}<div class="row wrap">${button('保存草稿','save-draft',result.id,'primary small')}${button('复制正文','copy-draft',result.id,'small')}${button('复制主题与正文','copy-draft-full',result.id,'small')}</div><p class="small muted">复制使用当前文字。保存与复制是两个独立操作。</p><details class="advanced"><summary>查看模型原始输出</summary><div class="source-body">${esc(o.subject)}\n\n${esc(o.bodyText)}</div></details></div>`;
      }
    }
    return `<section class="result-output">${content}</section>`;
  };
  ui.resultDetail = function(result) {
    if (!result) return '';
    const message = this.message(result.messageId), task = this.task(result.taskId), version = this.version(result.taskId,result.taskVersionId);
    const boundTasks = this.state.bindings.filter(b => b.mailboxId === result.mailboxId).map(b => this.task(b.taskId)).filter(Boolean);
    const isSource = this.readingTab === 'source';
    return `<div class="reading-header"><div class="row between">${status(result.status)}${pill(template(result.template).name,'outline')}</div><h2>${esc(message?.subject || '原邮件已过期')}</h2><div class="reading-meta"><span>${esc(task?.name)}</span><span>·</span><span>版本 ${version?.number || 1}</span><span>·</span><span>${fmt(result.createdAt)} 生成</span></div></div>
      <div class="reading-toolbar"><div class="reading-tabs" role="tablist" aria-label="结果阅读方式"><button role="tab" aria-selected="${!isSource}" aria-controls="reading-panel" tabindex="${isSource ? -1 : 0}" data-action="reading-tab" data-id="result">AI 结果</button><button role="tab" aria-selected="${isSource}" aria-controls="reading-panel" tabindex="${isSource ? 0 : -1}" data-action="reading-tab" data-id="source">原邮件</button></div>${button('导出结果','export-result',result.id,'small ghost')}</div>
      <div id="reading-panel" class="reading-body ${!isSource ? 'compare' : ''}" role="tabpanel" aria-label="${isSource ? '原邮件' : 'AI 结果'}">${isSource ? this.source(message,true) : this.output(result) + this.source(message)}<div class="manual-run"><label for="manual-task">对这封已保存邮件显式运行任务</label><div class="row"><select id="manual-task">${boundTasks.map(t=>`<option value="${t.id}" ${t.id === task.id ? 'selected' : ''}>${esc(t.name)} · v${t.currentVersion.number}</option>`).join('')}</select>${button('用选定版本运行','run-message',message?.id,'',message?.contentState !== 'available' || !boundTasks.length ? 'disabled' : '')}</div><p class="small muted">同版本返回已有运行；新版本另建结果，旧结果保留。</p></div></div><footer class="result-provenance"><span>${esc(this.account(result.mailboxId)?.name)} → ${esc(template(result.template).short)} → v${version?.number || 1}</span>${button('查看本次运行','run-detail',result.aiTaskRunId,'small ghost')}</footer>`;
  };
  ui.filteredRuns = function() { const f = this.runFilter; return this.state.runs.filter(r => (!f.kind || r.kind === f.kind) && (!f.mailboxId || r.mailboxId === f.mailboxId) && (!f.status || r.status === f.status)).slice().reverse(); };
  ui.runsPage = function() {
    const rows = this.filteredRuns(), active = this.state.runs.filter(r => ['queued','running','waiting_retry'].includes(r.status)).length;
    const successful = this.state.runs.filter(r => r.kind === 'sync' && r.status === 'succeeded').length;
    let html = this.heading('Run history','运行记录','每次检查与每项处理，都有独立的记录。',button('立即运行','run-picker','','primary'));
    html += `<div class="metrics"><div class="metric"><div class="metric-value">${active}</div><div class="metric-label">进行中与等待</div></div><div class="metric"><div class="metric-value">${this.pendingRuns().length}</div><div class="metric-label">需要处理的运行</div></div><div class="metric"><div class="metric-value">${successful}</div><div class="metric-label">已成功的邮箱检查</div></div></div>`;
    html += `<div class="filter-bar"><div class="field"><label for="run-kind">运行类型</label><select id="run-kind" data-run-filter="kind"><option value="">全部运行</option><option value="sync" ${this.runFilter.kind === 'sync' ? 'selected' : ''}>邮箱同步</option><option value="ai" ${this.runFilter.kind === 'ai' ? 'selected' : ''}>AI 任务</option></select></div><div class="field"><label for="run-mailbox">邮箱</label><select id="run-mailbox" data-run-filter="mailboxId"><option value="">全部邮箱</option>${this.state.mailboxes.map(m=>`<option value="${m.id}" ${this.runFilter.mailboxId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div><div class="field"><label for="run-status">运行状态</label><select id="run-status" data-run-filter="status"><option value="">全部状态</option>${['queued','running','waiting_retry','succeeded',...(this.runFilter.kind !== 'ai' ? ['partial'] : []),'failed','cancelled'].map(s=>`<option value="${s}" ${this.runFilter.status === s ? 'selected' : ''}>${labels[s]}</option>`).join('')}</select></div></div>`;
    if (!rows.length) return html + this.empty('这里还没有运行记录','连接邮箱并立即检查后，进度与结果会记录在这里。',button('查看配置','go-config'));
    return html + `<div class="panel run-table-wrap"><table class="run-table"><thead><tr><th>类型</th><th>邮箱 / 任务</th><th>状态</th><th>本次进度</th><th>开始时间</th><th><span class="sr-only">查看详情</span></th></tr></thead><tbody>${rows.map(run=>`<tr data-run-id="${run.id}"><td>${run.kind === 'sync' ? '邮箱同步' : 'AI 任务'}</td><td><button class="run-title" data-action="run-detail" data-id="${run.id}">${esc(run.kind === 'sync' ? this.account(run.mailboxId)?.name : this.task(run.taskId)?.name)}</button><div class="run-sub">${esc(run.kind === 'sync' ? run.phase === 'recovering' ? '正在恢复邮件身份' : '收件箱 · 增量检查' : this.account(run.mailboxId)?.name + ' · v' + (this.version(run.taskId,run.taskVersionId)?.number || 1))}</div></td><td>${status(run.status)}${run.status === 'waiting_retry' ? `<div class="run-sub">${fmt(run.nextAttemptAt)} 重试</div>` : ''}</td><td><span class="small">${run.kind === 'sync' ? '新邮件 ' + run.progress.persisted + ' 封' : run.status === 'succeeded' ? '已保存结果' : '已尝试 ' + run.attempt + ' 次'}</span></td><td><span class="mono">${fmt(run.startedAt || run.createdAt)}</span></td><td>${button('详情','run-detail',run.id,'small')}</td></tr>`).join('')}</tbody></table></div><p class="section-note">同步成功只表示邮件已保存。AI 任务随后独立执行；没有新邮件的检查也会显示成功。</p>`;
  };
  ui.render = function() {
    const appearance = document.body.dataset.appearance || 'paper';
    document.querySelector('#app').innerHTML = this.shell(this.view === 'config' ? this.configPage() : this.view === 'runs' ? this.runsPage() : this.resultsPage());
    document.querySelector('#appearance').value = appearance;
    document.querySelector('#test-outcome').value = this.testOutcome || 'success';
  };
  ui.navigate = function(view, focus = true) { this.view = view; this.render(); if (focus) document.querySelector('#page-title')?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); };
  ui.showResult = function(id) { const result = this.result(id); if (!result) return; this.resultFilter = { mailboxId: '', template: '', taskId: '', time: '' }; this.selectedResultId = id; this.mobileDetail = true; this.readingTab = 'result'; this.navigate('results'); };
  ui.reset = function(scenario) {
    this.timers.forEach(clearTimeout); this.timers.clear(); this.generation++;
    this.closeModal?.(); this.state = D.seed(scenario); this.editors = {}; this.resultFilter = { mailboxId: '', template: '', taskId: '', time: '' }; this.runFilter = { kind: '', mailboxId: '', status: '' };
    this.view = scenario === 'empty' || scenario === 'auth' ? 'config' : ['sync_failure','waiting','recovery','no_new'].includes(scenario) ? 'runs' : 'results'; this.configTab = 'mailboxes';
    this.selectedResultId = scenario === 'draft_conflict' ? 'res_reply_draft' : 'res_summary'; this.readingTab = 'result'; this.mobileDetail = scenario === 'draft_conflict'; this.forceConflict = scenario === 'draft_conflict'; this.testOutcome = 'success'; this.modal = null; this.render();
  };
  window.MailAIDemo = { snapshot: () => D.clone(ui.state), ui: () => ({ view: ui.view, selectedResultId: ui.selectedResultId, modal: ui.modal?.type || null }) };
})();
