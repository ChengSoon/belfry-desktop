(() => {
  'use strict';
  const u = window.MailUI, { D, esc, button, pill, status, fmt, providerLogo } = u;
  const checked = value => value ? 'checked' : '';
  const selectOptions = (items, selected) => items.map(([value,label])=>`<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const field = (label, id, value = '', extra = '', help = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" value="${esc(value)}" ${extra}>${help ? `<span class="field-help">${help}</span>` : ''}</div>`;
  const error = '<div class="form-error" id="form-error" role="alert"></div>';
  const footer = content => `<footer class="dialog-footer">${content}</footer>`;
  const header = (title, description) => `<header class="dialog-header"><div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(description)}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="关闭弹窗">×</button></header>`;
  const stepper = (steps, current) => `<div class="stepper" aria-label="配置步骤">${steps.map((s,i)=>`<span class="${i + 1 === current ? 'active' : ''}" ${i + 1 === current ? 'aria-current="step"' : ''}><b>${i + 1}</b>${s}</span>`).join('')}</div>`;
  u.closeModal = function() {
    const modal = document.querySelector('#modal');
    if (modal.open) modal.close();
    this.modal = null;
    const opener = this.returnFocus;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else if (this.returnSelector) document.querySelector(this.returnSelector)?.focus({ preventScroll: true });
  };
  u.openModal = function(data) {
    if (!document.querySelector('#modal').open) {
      this.returnFocus = document.activeElement;
      const opener = document.activeElement;
      this.returnSelector = opener?.id ? '#' + opener.id : opener?.dataset.action ? '[data-action="' + opener.dataset.action + '"]' + (opener.dataset.id ? '[data-id="' + opener.dataset.id + '"]' : '') : '#page-title';
    }
    this.modal = data; this.renderModal();
    const modal = document.querySelector('#modal');
    if (!modal.open) modal.showModal();
  };
  u.renderModal = function() {
    if (!this.modal) return;
    const focused = document.querySelector('#modal').contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.id;
    const focusAction = focused?.dataset.action;
    const renderers = { mailbox: () => this.mailboxDialog(), task: () => this.taskDialog(), service: () => this.serviceDialog(), run: () => this.runDialog(), picker: () => this.pickerDialog(), recovery: () => this.recoveryDialog(), copy: () => this.copyDialog() };
    document.querySelector('#modal-content').innerHTML = renderers[this.modal.type]();
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    else if (focusAction) document.querySelector('#modal [data-action="' + focusAction + '"]')?.focus({ preventScroll: true });
  };
  u.openMailbox = function(id, intent = 'settings') {
    const existing = id ? this.account(id) : null;
    this.openModal({ type: 'mailbox', step: existing ? intent === 'reauthorize' ? 2 : 3 : 1, intent, existing: !!existing, created: !!existing,
      draft: existing ? D.clone(existing) : { id: this.id('mbx'), revision: 1, name: '我的工作邮箱', provider: 'imap', accountEmail: 'reader@example.test', connectionState: 'untested', credentialConfigured: false, imap: { host: 'imap.example.test', port: 993, security: 'tls', username: 'reader@example.test' }, syncPolicy: { enabled: false, intervalSeconds: 300, folders: ['inbox'], activatedAt: null }, lastCheckedAt: null, lastSuccessfulSyncAt: null, nextSyncAt: null, activeSyncRunId: null, lastError: null }, test: null });
  };
  u.mailboxDialog = function() {
    const m = this.modal, draft = m.draft, provider = D.providers[draft.provider], testing = m.test && ['queued','running'].includes(m.test.status);
    let body = stepper(['选择邮箱','测试连接','同步设置'],m.step);
    if (m.step === 1) body += `<div class="provider-grid">${Object.entries(D.providers).map(([id,p])=>`<button type="button" class="provider-option" data-action="select-provider" data-id="${id}" aria-pressed="${draft.provider === id}">${providerLogo(id)}<strong>${esc(p.name)}</strong><p>${esc(p.description)}</p>${pill(p.stage + ' · 计划接入','outline')}</button>`).join('')}</div><div class="quiet-note">选择演示接入方式。实际可用性取决于服务商接口、账号授权与管理员策略；目前均未连接或验证。</div>`;
    if (m.step === 2) body += `<div class="row">${providerLogo(draft.provider)}<div><strong>${esc(provider.name)}</strong><p class="small muted">${m.intent === 'reauthorize' ? '恢复当前账号，保留同步边界和历史运行。' : '先测试，再安排定时检查。'}</p></div></div><div class="form-grid">${field('邮箱名称','mailbox-name',draft.name,'required maxlength="40"')}${field('演示邮箱地址','mailbox-email',draft.accountEmail,'type="email" required ' + (m.created ? 'readonly' : ''))}${draft.provider === 'imap' ? field('IMAP 服务器','imap-host',draft.imap?.host || 'imap.example.test','required ' + (m.created ? 'readonly' : '')) + field('安全连接','imap-security','TLS · 993','readonly','首版使用直接 TLS；其他端口待验证。') + '<div class="full">' + field('演示授权码','mailbox-secret','DEMO-ONLY','type="password" readonly autocomplete="off"','占位内容，不输入或保存真实凭据。') + '</div>' : '<div class="quiet-note full">将模拟官方授权流程。这个原型不会打开真实授权页面。</div>'}</div>
      ${m.test ? `<div class="test-status" role="status">${testing ? '<span class="spinner" aria-hidden="true"></span>' : ''}${m.test.status === 'queued' ? '模拟测试已排队' : m.test.status === 'running' ? '正在模拟检查连接与收件箱权限…' : m.test.status === 'succeeded' ? '模拟连接测试成功' : '模拟连接测试失败'}${m.test.status === 'succeeded' ? '<div class="test-checks"><span>✓ 安全连接</span><span>✓ 账号认证</span><span>✓ 收件箱权限</span></div>' : m.test.error ? '<p class="field-error">' + esc(m.test.error.message) + '</p>' : ''}</div>` : ''}
      <div>${button(testing ? '正在模拟测试…' : draft.provider === 'imap' ? '模拟测试连接' : '模拟授权并测试','test-mailbox',draft.id,'primary',testing ? 'disabled' : '')}</div><p class="field-help">连接测试检查访问权限，不抓取邮件。演示测试不会发出网络请求。</p>`;
    if (m.step === 3) body += `<div class="row between"><div class="row">${providerLogo(draft.provider)}<div><h3>${esc(draft.name)}</h3><p class="small muted">${esc(draft.accountEmail)}</p></div></div>${status(draft.connectionState)}</div><div class="form-grid">${field('检查间隔（分钟）','interval-minutes',draft.syncPolicy.intervalSeconds / 60,'type="number" required min="1" max="1440" step="1"','可设置 1–1440 分钟；默认 5 分钟。')}${field('邮件范围','mailbox-folder','收件箱 · 激活后收到的新邮件','readonly')}<label class="checkbox-label full"><input type="checkbox" name="sync-enabled" id="sync-enabled" ${checked(draft.syncPolicy.enabled)}><span>开启定时检查<br><span class="field-help">连接健康与定时开关分别管理。暂停定时后仍能手动检查。</span></span></label></div><div class="quiet-note">${draft.syncPolicy.activatedAt ? '当前激活边界：' + fmt(draft.syncPolicy.activatedAt,true) + '。更改频率、暂停或重新授权均保留该边界。' : '首次开启或首次立即检查时建立激活边界。建议先保存 AI 任务，再开始同步。'} 已读状态不影响新邮件同步。</div>${m.existing ? `<div class="row wrap">${button('重新测试连接','mailbox-test-step',draft.id,'small')}${button('更新演示凭据','reauthorize',draft.id,'small')}</div>` : ''}`;
    let actions = button(m.step === 1 || m.existing ? '取消' : '上一步',m.step === 1 || m.existing ? 'close-modal' : 'mailbox-back','','ghost');
    if (m.step === 1) actions += button('下一步','mailbox-next','','primary');
    if (m.step === 2) actions += button('下一步','mailbox-next','','primary',!m.test || m.test.status !== 'succeeded' ? 'disabled' : '');
    if (m.step === 3) actions += `<button type="submit" class="button primary">${m.existing ? '保存设置' : '保存并配置任务'}</button>`;
    return `<form id="mailbox-form" data-form="mailbox">${header(m.intent === 'reauthorize' ? '恢复邮箱授权' : m.existing ? '邮箱设置' : '连接邮箱','本地演示 · 使用合成账号与凭据') }<div class="dialog-body">${body}${error}</div>${footer(actions)}</form>`;
  };
  u.openTask = function(id) {
    if (!this.state.mailboxes.length) { this.toast('先连接一个邮箱，再创建任务。'); this.openMailbox(); return; }
    if (!this.state.services.length) { this.toast('先配置 AI 服务，保存后继续创建任务。'); this.openService(null,true); return; }
    const existing = id ? this.task(id) : null, tt = D.templates[0], service = this.state.services[0];
    this.openModal({ type: 'task', step: existing ? 2 : 1, editingId: id || null, preview: false,
      selectedMailboxes: existing ? this.state.bindings.filter(b => b.taskId === id && b.enabled).map(b=>b.mailboxId) : [this.state.mailboxes.at(-1).id],
      draft: existing ? D.clone(existing) : { name: tt.name, enabled: true, definition: { template: tt.id, instructions: tt.instructions, matching: { senderDomains: [], subjectContainsAny: [], hasAttachments: null }, aiServiceId: service.id, aiServiceConfigVersionId: service.configVersionId, model: service.defaultModel, modelSettings: { temperature: 0.2, maxOutputTokens: 1200 }, templateOptions: D.clone(tt.options) } } });
  };
  u.taskDialog = function() {
    const m = this.modal, draft = m.draft, def = draft.definition, tt = u.template(def.template), service = this.state.services.find(s => s.id === def.aiServiceId);
    let body = stepper(['选择任务','设置与绑定'],m.step);
    if (m.step === 1) body += `<div class="template-grid">${D.templates.map(t=>`<button type="button" class="template-option" data-action="select-template" data-id="${t.id}" aria-pressed="${def.template === t.id}"><span class="template-mark" aria-hidden="true">${t.mark}</span><span><span class="row between"><strong>${t.name}</strong>${pill(t.stage + ' 演示','outline')}</span><p>${t.description}</p></span></button>`).join('')}</div><div class="quiet-note">日报与汇总报表属于 M3 后续，使用独立的统计区间、周期和时区。</div>`;
    if (m.step === 2) {
      body += `<div class="row between task-summary"><div class="row"><span class="template-mark" aria-hidden="true">${tt.mark}</span><strong>${tt.name}</strong>${pill(tt.stage + ' 演示','outline')}</div>${!m.editingId ? button('更换类型','task-back','','small ghost') : '<span class="small muted">修改处理规则会创建新版本</span>'}</div><div class="form-grid">${field('任务名称','task-name',draft.name,'required maxlength="50"')}<div class="field"><label for="task-service">AI 服务</label><select id="task-service" name="task-service">${selectOptions(this.state.services.map(s=>[s.id,s.name]),def.aiServiceId)}</select></div><fieldset class="field full checkbox-panel"><legend>来源邮箱（可多选）</legend>${this.state.mailboxes.map(mailbox=>`<label class="checkbox-label"><input type="checkbox" name="task-mailbox" value="${mailbox.id}" ${checked(m.selectedMailboxes.includes(mailbox.id))}><span>${esc(mailbox.name)} <span class="small muted">${esc(mailbox.accountEmail)}</span></span></label>`).join('')}</fieldset></div>`;
      if (def.template === 'classification') body += field('分类标签（逗号分隔）','task-categories',(def.templateOptions.categories || []).join('，'),'required','输出只能使用这些标签；未匹配时保留未知。');
      if (def.template === 'translation') body += `<div class="field"><label for="target-language">目标语言</label><select id="target-language" name="target-language">${selectOptions([['zh-CN','简体中文'],['en','英语'],['ja','日语']],def.templateOptions.targetLanguage)}</select></div>`;
      if (def.template === 'field_extraction') body += `<div class="field"><label>需要提取的字段</label><div id="extraction-fields" class="stack-sm">${(def.templateOptions.fields || []).map((f,i)=>`<div class="field-row"><input aria-label="字段 ${i+1} 名称" name="field-name" value="${esc(f.name)}" required pattern="[A-Za-z][A-Za-z0-9_]{0,39}"><select name="field-type" aria-label="字段 ${i+1} 类型">${selectOptions([['string','文本'],['number','数字'],['boolean','是 / 否']],f.type)}</select><button type="button" class="icon-button" aria-label="移除字段 ${i+1}" data-action="remove-field" data-id="${i}">×</button></div>`).join('')}</div>${button('＋ 添加字段','add-field','','small ghost')}<p class="field-help">字段名用字母开头；值未提供时保留为空。</p></div>`;
      body += `<div class="field"><label for="task-instructions">处理要求</label><textarea id="task-instructions" name="task-instructions" rows="3" required>${esc(def.instructions)}</textarea><span class="field-help">可以补充摘要长度、措辞或提取要求。邮件里的指令不作为操作授权。</span></div><details class="advanced"><summary>筛选与模型设置 ${pill('M2 演示')}</summary><div class="form-grid">${field('发件人域名','sender-domains',def.matching.senderDomains.join('，'),'','多项用逗号分隔；留空表示不限。')}${field('主题包含任一词','subject-contains',def.matching.subjectContainsAny.join('，'),'','留空表示不限。')}<div class="field"><label for="has-attachments">附件条件</label><select id="has-attachments" name="has-attachments">${selectOptions([['','不限'],['true','有附件'],['false','无附件']],def.matching.hasAttachments === null ? '' : def.matching.hasAttachments)}</select><span class="field-help">只判断元数据，附件正文属于后续。</span></div>${field('模型','task-model',def.model,'required')}${field('温度','model-temperature',def.modelSettings.temperature,'type="number" min="0" max="2" step="0.1" required')}${field('输出 token 上限','max-output-tokens',def.modelSettings.maxOutputTokens,'type="number" min="1" max="32000" step="1" required')}${service && service.configVersionId !== def.aiServiceConfigVersionId ? '<label class="checkbox-label full"><input type="checkbox" name="adopt-config"><span>采用 AI 服务的最新配置版本</span></label>' : ''}</div><p class="field-help">不同筛选维度同时满足；同一维度内任一项满足。首个实现阶段先支持不限条件。</p></details><label class="checkbox-label"><input type="checkbox" name="task-enabled" ${checked(draft.enabled)}><span>保存后启用任务</span></label><div class="quiet-note">仅作用于保存后新入库且匹配的邮件。已有邮件可在结果详情用指定版本运行；保存任务不会自动重跑历史邮件。</div><div>${button('预览示例输出','preview-task','','small')}</div>${m.preview ? `<div class="preview-panel"><div class="eyebrow">模板示例 · 非 AI 实时生成</div>${this.output({ template: def.template, output: D.outputFor(def.template,this.state.messages[0] || D.seed().messages[0],def.templateOptions) },true)}</div>` : ''}`;
    }
    return `<form id="task-form" data-form="task">${header(m.editingId ? '编辑 AI 任务' : '配置 AI 任务','一次配置，可关联多个邮箱；各任务独立执行。')}<div class="dialog-body">${body}${error}</div>${footer(button('取消','close-modal','','ghost') + (m.step === 1 ? button('下一步','task-next','','primary') : '<button type="submit" class="button primary">' + (m.editingId ? '保存任务' : '保存并查看配置') + '</button>'))}</form>`;
  };
  u.openService = function(id, continueTask = false) {
    const existing = id ? this.state.services.find(s => s.id === id) : null;
    this.openModal({ type: 'service', editingId: id || null, continueTask, test: null,
      draft: existing ? D.clone(existing) : { id: this.id('ais'), name: '默认 AI 服务', adapterId: 'deployment_default', baseUrl: 'https://ai.example.test/v1', defaultModel: 'demo-model', connectionState: 'untested' } });
  };
  u.serviceDialog = function() {
    const m = this.modal, d = m.draft, testing = m.test && ['queued','running'].includes(m.test.status);
    return `<form id="service-form" data-form="service">${header(m.editingId ? 'AI 服务设置' : '配置 AI 服务','演示配置 · 真实提供方与模型由部署时选择')}<div class="dialog-body"><div class="form-grid">${field('服务名称','service-name',d.name,'required')}${field('适配器','service-adapter','部署选定的适配器','readonly')}${field('演示服务地址','service-url',d.baseUrl,'type="url" required')}${field('演示模型','service-model',d.defaultModel,'required')}<div class="full">${field('本次配置的演示 API 密钥','service-secret','DEMO-KEY-ONLY','type="password" readonly autocomplete="off"','此字段仅显示本配置的占位凭据；不输入真实密钥。')}</div></div><div class="quiet-note">测试绑定本次配置版本，使用固定短样本。更换地址时使用新配置的凭据；旧任务继续关联旧配置。当前演示不发出请求，真实测试可能产生少量模型调用费用。</div>${m.test ? `<div class="test-status" role="status">${testing ? '<span class="spinner" aria-hidden="true"></span>正在模拟服务测试…' : m.test.status === 'succeeded' ? '模拟测试成功 · 样本生成与结构校验通过' : '模拟测试失败 · 请检查服务配置'}</div>` : ''}${button(testing ? '测试中…' : '模拟测试 AI 服务','test-service-modal','','',testing ? 'disabled' : '')}${error}</div>${footer(button('取消','close-modal','','ghost') + `<button type="submit" class="button primary" ${!m.test || m.test.status !== 'succeeded' ? 'disabled' : ''}>保存服务${m.continueTask ? '并继续' : ''}</button>`)}</form>`;
  };
  u.openRun = function(id) { if (this.run(id)) this.openModal({ type: 'run', id }); };
  u.runDialog = function() {
    const run = this.run(this.modal.id), mailbox = this.account(run.mailboxId), task = this.task(run.taskId), version = task ? this.version(task.id,run.taskVersionId) : null;
    const errorAction = run.error?.action;
    let body = `<div class="row between"><div><h3>${esc(run.kind === 'sync' ? mailbox.name : task?.name)}</h3><p class="small muted">${esc(mailbox.accountEmail)}${version ? ' · 任务版本 ' + version.number : ' · 收件箱'}</p></div>${status(run.status)}</div>`;
    if (run.status === 'queued' || run.status === 'running') body += '<div class="test-status" role="status"><span class="spinner" aria-hidden="true"></span>正在模拟处理，请稍候。进度按已完成数量显示。</div>';
    if (run.kind === 'sync') body += `<div class="progress-grid"><div class="progress-item"><strong>${run.progress.persisted}</strong><span>新邮件已保存</span></div><div class="progress-item"><strong>${run.progress.aiRunsQueued}</strong><span>AI 任务已排队</span></div><div class="progress-item"><strong>${run.progress.duplicates}</strong><span>重复邮件已跳过</span></div></div>${run.status === 'succeeded' && run.progress.persisted === 0 ? '<div class="notice success"><div><div class="notice-title">同步正常，暂无新邮件</div><p>这是一次成功的检查，无需重试。</p></div></div>' : ''}${run.phase === 'recovering' ? '<div class="quiet-note">邮箱的远端编号发生变化，正在恢复邮件身份。这与账号授权失效分别处理。</div>' : ''}`;
    if (run.error) body += `<div class="notice ${run.status === 'waiting_retry' || run.status === 'partial' ? 'warning' : 'danger'}"><span class="notice-symbol" aria-hidden="true">!</span><div class="grow"><div class="notice-title">${esc(run.error.message)}</div>${run.status === 'waiting_retry' ? `<p>已安排 ${fmt(run.nextAttemptAt)} 自动重试，请等待原运行继续。</p>` : run.kind === 'ai' ? '<p>原邮件与其他成功结果已保留。</p>' : ''}</div></div>`;
    const actionButtons = [];
    if (errorAction === 'reauthorize_mailbox' && mailbox.connectionState === 'auth_required') actionButtons.push(button('重新授权','reauthorize',mailbox.id,'primary'));
    if (run.status === 'failed' && (run.error?.retryable || errorAction === 'reauthorize_mailbox' && mailbox.connectionState === 'connected')) actionButtons.push(button('重试此运行','retry-run',run.id,'primary'));
    if (errorAction === 'edit_configuration') actionButtons.push(button('修改任务配置','edit-task',run.taskId,'primary'));
    if (errorAction === 'review_recovery') {
      const pending = this.state.recoveryItems.find(item=>item.mailboxId === run.mailboxId && item.status === 'pending');
      actionButtons.push(pending ? button('查看待确认邮件','open-recovery',pending.id,'primary') : button('开始新的增量检查','sync-now',run.mailboxId,'primary'));
      if (!pending) body += '<div class="quiet-note">待确认项已处理。原运行记录保留，可开始新的增量检查。</div>';
    }
    if (run.status === 'succeeded' && run.resultId) actionButtons.push(button('查看结果与原文','open-result',run.resultId,'primary'));
    if (run.kind === 'sync' && run.status === 'succeeded') actionButtons.push(button('查看处理结果','go-results','','primary'));
    body += `<div class="row wrap">${actionButtons.join('')}</div><div><h3>尝试记录</h3><ol class="history-timeline">${run.attempts.length ? run.attempts.map(attempt=>`<li><div class="row between"><span>第 ${attempt.number} 次尝试</span>${status(attempt.status)}</div><p>${fmt(attempt.startedAt)}${attempt.finishedAt ? ' → ' + fmt(attempt.finishedAt) : ' · 尚未结束'}${attempt.error ? ' · ' + esc(attempt.error.code) : ''}</p></li>`).join('') : '<li class="muted">排队中，尚未开始尝试。</li>'}</ol></div><details class="advanced"><summary>来源与诊断信息</summary><dl class="source-envelope"><dt>运行</dt><dd class="mono">${esc(run.id)}</dd><dt>类型</dt><dd>${run.kind === 'sync' ? '邮箱同步' : 'AI 任务'}</dd><dt>触发</dt><dd>${({ manual: '手动', schedule: '定时', message_ingest: '邮件入库', continuation: '继续同步' })[run.trigger]}</dd>${version ? `<dt>版本</dt><dd class="mono">${esc(run.taskVersionId)}</dd>` : ''}${run.error ? `<dt>错误码</dt><dd class="mono">${esc(run.error.code)}</dd>` : ''}</dl><p class="field-help">日常运行记录不包含邮箱凭据或邮件正文。重试沿用原运行及原任务版本。</p></details>`;
    return header(run.kind === 'sync' ? '邮箱同步详情' : 'AI 任务详情','模拟运行 · 同步与 AI 执行独立记录') + `<div class="dialog-body">${body}</div>` + footer(button('关闭','close-modal'));
  };
  u.pickerDialog = function() {
    return `<form id="run-picker-form" data-form="run-picker">${header('立即运行','先检查一个邮箱，匹配的新邮件会自动交给已绑定的任务。')}<div class="dialog-body">${this.state.mailboxes.length ? `<div class="checkbox-panel">${this.state.mailboxes.map((m,i)=>`<label class="checkbox-label"><input type="radio" name="run-mailbox" value="${m.id}" ${i === 0 ? 'checked' : ''}><span>${esc(m.name)} <span class="small muted">${esc(m.accountEmail)}</span><br>${status(m.connectionState)} <span class="small muted">${m.syncPolicy.enabled ? '定时已启用' : '定时已暂停，仍可立即检查'}</span></span></label>`).join('')}</div><div class="quiet-note">每个邮箱的本地演示会送达一封新的样例邮件。再次检查显示零新增，不重复生成同版本结果。</div>` : '<p>先连接一个邮箱并配置任务。</p>'}</div>${footer(button('取消','close-modal','','ghost') + (this.state.mailboxes.length ? '<button class="button primary" type="submit">开始模拟运行</button>' : button('连接邮箱','new-mailbox','','primary')))}</form>`;
  };
  u.openRecovery = function(id) { this.openModal({ type: 'recovery', id }); };
  u.recoveryDialog = function() {
    const item = this.state.recoveryItems.find(r=>r.id === this.modal.id), existing = this.message(item.candidateMessageIds[0]);
    let body = `<div class="quiet-note">邮箱重建了编号，系统无法确定这两份来源是否为同一封邮件。确认前暂不为待判定项生成新的 AI 结果。</div><div class="compare-grid"><section><h3>待确认的邮件</h3><p class="small muted">${fmt(item.receivedAt,true)}</p><strong>${esc(item.subject)}</strong><p class="source-body">${esc(item.bodyText)}</p></section><section><h3>已保存的候选邮件</h3><p class="small muted">${fmt(existing.receivedAt,true)}</p><strong>${esc(existing.subject)}</strong><p class="source-body">${esc(existing.bodyText)}</p></section></div>`;
    if (item.status === 'pending') body += `<div class="recovery-actions">${button('是同一封：关联到已有邮件','resolve-recovery-link',item.id,'primary')}<p class="field-help">沿用已有邮件与结果，同版本任务不会重复执行。</p>${button('是不同邮件：保留为独立邮件','resolve-recovery-separate',item.id)}<p class="field-help">保存为新的邮件，再按当前启用的绑定安排任务。</p></div>`;
    else body += `<div class="notice success"><div><div class="notice-title">${item.status === 'linked' ? '已关联到原邮件' : '已保留为独立邮件'}</div><p>本次身份确认已保存为演示状态。</p></div></div>`;
    return header('确认邮件身份','同一个邮箱内比较来源，保留你的明确决定。') + `<div class="dialog-body">${body}</div>` + footer(button('关闭','close-modal'));
  };
  u.copyDialog = function() {
    return header('手动复制','浏览器未允许自动复制，文字仍完整保留。') + `<div class="dialog-body"><div class="field"><label for="manual-copy">按 ⌘C / Ctrl+C 复制所选文字</label><textarea id="manual-copy" rows="10" readonly>${esc(this.modal.text)}</textarea></div></div>` + footer(button('完成','close-modal'));
  };
})();
