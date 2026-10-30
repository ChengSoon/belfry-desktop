/* 模拟状态机：不请求 API，不连接邮箱，不存储凭据。 */
(() => {
  'use strict';
  const u = window.MailUI, D = u.D;
  const data = id => new FormData(document.getElementById(id));
  const value = (form, key) => String(form.get(key) ?? '').trim();
  const split = text => String(text).split(/[,，;；\n]/).map(s=>s.trim()).filter(Boolean);
  const valid = id => document.getElementById(id).reportValidity();
  const formError = text => { const box = document.querySelector('#form-error'); if (box) box.textContent = text; };
  const refresh = run => { u.render(); if (u.modal?.type === 'run' && (!run || u.modal.id === run.id)) u.renderModal(); };
  u.captureMailbox = function() {
    if (this.modal?.type !== 'mailbox') return;
    const m = this.modal, form = data('mailbox-form');
    if (m.step === 2) {
      m.draft.name = value(form,'mailbox-name');
      if (!m.created) {
        m.draft.accountEmail = value(form,'mailbox-email');
        if (m.draft.provider === 'imap') m.draft.imap = { host: value(form,'imap-host'), port: 993, security: 'tls', username: m.draft.accountEmail };
      }
    }
    if (m.step === 3) { m.draft.syncPolicy.intervalSeconds = Number(form.get('interval-minutes')) * 60; m.draft.syncPolicy.enabled = form.has('sync-enabled'); }
  };
  u.testMailbox = function() {
    if (!valid('mailbox-form')) return;
    this.captureMailbox(); const m = this.modal;
    if (m.test && ['queued','running'].includes(m.test.status)) return;
    if (!m.created) { m.draft.credentialConfigured = true; this.state.mailboxes.push(D.clone(m.draft)); m.created = true; }
    const mailbox = this.account(m.draft.id), outcome = this.testOutcome || 'success';
    const test = { id: this.id('test'), targetType: 'mailbox', targetId: mailbox.id, status: 'queued', createdAt: this.now(), checks: [], error: null };
    this.state.tests.push(test); m.test = test; this.render(); this.renderModal();
    this.defer(()=>{ test.status = 'running'; if (this.modal === m) this.renderModal(); },180);
    this.defer(()=>{
      test.finishedAt = this.now(2);
      if (outcome === 'success') {
        test.status = 'succeeded'; test.checks = ['tls','authentication','inbox_access'].map(name=>({ name, status: 'passed' }));
        Object.assign(mailbox,{ name: m.draft.name, connectionState: 'connected', credentialConfigured: true, lastError: null });
        if (mailbox.syncPolicy.enabled) mailbox.nextSyncAt = this.later(mailbox.syncPolicy.intervalSeconds);
        m.draft = D.clone(mailbox);
      } else {
        const authorization = outcome === 'auth';
        test.status = 'failed'; test.error = { code: authorization ? 'MAILBOX_AUTH_REQUIRED' : 'MAILBOX_NETWORK_ERROR', message: authorization ? '演示凭据验证未通过，请更新凭据后重试。' : '演示服务器连接超时，请检查配置后重试。', retryable: !authorization, action: authorization ? 'reauthorize_mailbox' : 'edit_configuration' };
        test.checks = [{ name: 'tls', status: authorization ? 'passed' : 'failed' },{ name: 'authentication', status: authorization ? 'failed' : 'skipped' },{ name: 'inbox_access', status: 'skipped' }];
        mailbox.connectionState = authorization ? 'auth_required' : 'error'; mailbox.lastError = D.clone(test.error); m.draft = D.clone(mailbox);
      }
      this.render(); if (this.modal === m) this.renderModal();
    },850);
  };
  u.saveMailbox = function() {
    if (this.modal.step !== 3) { if (this.modal.step === 2 && this.modal.test?.status !== 'succeeded') this.testMailbox(); return; }
    if (!valid('mailbox-form')) return;
    this.captureMailbox(); const m = this.modal, draft = m.draft;
    if (draft.syncPolicy.enabled && draft.connectionState !== 'connected') { formError('先完成连接测试，再开启定时检查。'); return; }
    const mailbox = this.account(draft.id);
    mailbox.name = draft.name; mailbox.syncPolicy.enabled = draft.syncPolicy.enabled; mailbox.syncPolicy.intervalSeconds = draft.syncPolicy.intervalSeconds;
    if (mailbox.syncPolicy.enabled && !mailbox.syncPolicy.activatedAt) mailbox.syncPolicy.activatedAt = this.now();
    mailbox.nextSyncAt = mailbox.syncPolicy.enabled ? this.later(mailbox.syncPolicy.intervalSeconds) : null; mailbox.revision++;
    const continueTask = !m.existing; this.closeModal(); this.configTab = 'mailboxes'; this.navigate('config');
    if (continueTask) { this.toast('演示邮箱已连接，接着配置 AI 任务。'); this.openTask(); }
    else this.toast('邮箱设置已保存。历史运行与激活边界保持可追溯。');
  };
  u.captureService = function() {
    const form = data('service-form'), draft = this.modal.draft;
    Object.assign(draft, { name: value(form,'service-name'), baseUrl: value(form,'service-url'), defaultModel: value(form,'service-model') });
  };
  u.testService = function() {
    if (!valid('service-form')) return;
    this.captureService(); const m = this.modal;
    if (m.test && ['queued','running'].includes(m.test.status)) return;
    const existing = this.state.services.find(s=>s.id === m.editingId);
    const usesExistingConfig = existing && existing.baseUrl === m.draft.baseUrl && existing.defaultModel === m.draft.defaultModel;
    const usesPreviousTest = m.testedValues && m.testedValues.baseUrl === m.draft.baseUrl && m.testedValues.defaultModel === m.draft.defaultModel;
    const configVersionId = usesExistingConfig ? existing.configVersionId : usesPreviousTest ? m.test.configVersionId : this.id('aicfg');
    m.draft.configVersionId = configVersionId;
    const test = { id: this.id('test'), targetType: 'ai_service', targetId: m.draft.id, configVersionId, status: 'queued', createdAt: this.now(), checks: [], error: null };
    this.state.tests.push(test); m.test = test; m.testedValues = D.clone(m.draft); this.renderModal();
    this.defer(()=>{ test.status = 'running'; if (this.modal === m) this.renderModal(); },180);
    this.defer(()=>{ test.status = 'succeeded'; test.finishedAt = this.now(2); test.checks = [{ name: 'sample_generation', status: 'passed' },{ name: 'schema_validation', status: 'passed' }]; m.draft.connectionState = 'connected'; if (this.modal === m) this.renderModal(); },750);
  };
  u.saveService = function() {
    if (!valid('service-form')) return;
    this.captureService(); const m = this.modal, draft = m.draft;
    if (!m.test || m.test.status !== 'succeeded') return formError('请先完成模拟测试。');
    if (draft.baseUrl !== m.testedValues.baseUrl || draft.defaultModel !== m.testedValues.defaultModel) return formError('连接参数已改变，请重新测试后保存。');
    let service = this.state.services.find(s=>s.id === m.editingId);
    if (service) {
      if (service.baseUrl !== draft.baseUrl || service.defaultModel !== draft.defaultModel) service.configVersionId = m.test.configVersionId;
      Object.assign(service,{ name: draft.name, baseUrl: draft.baseUrl, defaultModel: draft.defaultModel, connectionState: 'connected', lastTestedAt: m.test.finishedAt, lastError: null }); service.revision++;
    } else {
      service = { ...D.clone(draft), revision: 1, configVersionId: m.test.configVersionId, credentialConfigured: true, lastTestedAt: m.test.finishedAt, lastError: null };
      this.state.services.push(service);
    }
    const next = m.continueTask; this.closeModal(); this.configTab = 'services'; this.navigate('config'); this.toast('演示 AI 服务已保存。'); if (next) this.openTask();
  };
  u.captureTask = function() {
    const m = this.modal;
    if (m?.type !== 'task' || m.step !== 2) return;
    const form = data('task-form'), d = m.draft, def = d.definition;
    d.name = value(form,'task-name'); d.enabled = form.has('task-enabled'); m.selectedMailboxes = form.getAll('task-mailbox').map(String);
    const selectedService = this.state.services.find(s=>s.id === form.get('task-service'));
    if (selectedService && (selectedService.id !== def.aiServiceId || form.has('adopt-config'))) { def.aiServiceId = selectedService.id; def.aiServiceConfigVersionId = selectedService.configVersionId; }
    def.instructions = value(form,'task-instructions'); def.model = value(form,'task-model'); def.modelSettings = { temperature: Number(form.get('model-temperature')), maxOutputTokens: Number(form.get('max-output-tokens')) };
    def.matching = { senderDomains: split(value(form,'sender-domains')).map(s=>s.toLowerCase()), subjectContainsAny: split(value(form,'subject-contains')), hasAttachments: value(form,'has-attachments') === '' ? null : value(form,'has-attachments') === 'true' };
    if (def.template === 'classification') def.templateOptions.categories = [...new Set(split(value(form,'task-categories')))];
    if (def.template === 'translation') def.templateOptions.targetLanguage = value(form,'target-language');
    if (def.template === 'field_extraction') def.templateOptions.fields = form.getAll('field-name').map((name,i)=>({ name: String(name).trim(), type: String(form.getAll('field-type')[i]) }));
  };
  u.saveTask = function() {
    if (this.modal.step !== 2 || !valid('task-form')) return;
    this.captureTask(); const m = this.modal, draft = m.draft;
    if (!m.selectedMailboxes.length) return formError('至少选择一个来源邮箱。');
    if (draft.definition.template === 'classification' && !draft.definition.templateOptions.categories.length) return formError('请设置至少一个分类标签。');
    if (draft.definition.template === 'field_extraction') {
      const fields = draft.definition.templateOptions.fields;
      if (!fields.length || new Set(fields.map(f=>f.name)).size !== fields.length) return formError('请设置至少一个字段，字段名不能重复。');
    }
    let task = m.editingId ? this.task(m.editingId) : null;
    const changed = !task || JSON.stringify(task.definition) !== JSON.stringify(draft.definition);
    if (!task) { task = { id: this.id('task'), revision: 0, name: draft.name, enabled: draft.enabled, definition: D.clone(draft.definition), currentVersion: null, versions: [] }; this.state.tasks.push(task); }
    task.name = draft.name; task.enabled = draft.enabled; task.revision++;
    if (changed) {
      const definition = D.clone(draft.definition), version = { id: this.id('taskver'), number: (task.currentVersion?.number || 0) + 1, template: definition.template, aiServiceId: definition.aiServiceId, aiServiceConfigVersionId: definition.aiServiceConfigVersionId, model: definition.model, outputSchemaVersion: definition.template + '.v1', createdAt: this.now(), definition };
      task.definition = D.clone(definition); task.currentVersion = D.clone(version); task.versions.push(D.clone(version));
    }
    this.state.mailboxes.forEach(mailbox => {
      let binding = this.state.bindings.find(b=>b.taskId === task.id && b.mailboxId === mailbox.id);
      const enabled = m.selectedMailboxes.includes(mailbox.id);
      if (!binding && enabled) { binding = { id: this.id('bind'), revision: 1, mailboxId: mailbox.id, taskId: task.id, enabled: true, effectiveFrom: this.now(), appliesTo: 'future_ingest' }; this.state.bindings.push(binding); }
      else if (binding && binding.enabled !== enabled) { binding.enabled = enabled; binding.revision++; if (enabled) binding.effectiveFrom = this.now(); }
    });
    this.closeModal(); this.configTab = 'tasks'; this.navigate('config'); this.toast(changed && task.currentVersion.number > 1 ? '已保存版本 ' + task.currentVersion.number + '；已有邮件与结果不会自动重跑。' : '任务已保存，仅处理此后新入库且匹配的邮件。');
  };
  function matches(def, message) {
    const m = def.matching, domain = message.from.address.split('@')[1].toLowerCase();
    return (!m.senderDomains.length || m.senderDomains.includes(domain)) && (!m.subjectContainsAny.length || m.subjectContainsAny.some(term=>message.subject.includes(term))) && (m.hasAttachments === null || m.hasAttachments === !!message.attachments.length);
  }
  function startAttempt(run) {
    run.status = 'running'; run.attempt++; run.startedAt = u.now(); run.finishedAt = null; run.error = null;
    run.attempts.push({ number: run.attempt, startedAt: run.startedAt, finishedAt: null, status: 'running', error: null }); refresh(run);
  }
  function finishAttempt(run) {
    run.finishedAt = u.now(); Object.assign(run.attempts.at(-1), { status: run.status, finishedAt: run.finishedAt, error: D.clone(run.error) }); refresh(run);
  }
  u.enqueueAI = function(message, task, trigger = 'message_ingest') {
    const version = task.currentVersion;
    const existing = this.state.runs.find(r=>r.kind === 'ai' && r.messageId === message.id && r.taskVersionId === version.id);
    if (existing) return existing;
    const run = D.run(this.id('airun'),'ai',{ mailboxId: message.mailboxId, messageId: message.id, taskId: task.id, taskVersionId: version.id, status: 'queued', trigger, attempt: 0, createdAt: this.now(), startedAt: null, finishedAt: null, resultId: null, attempts: [] });
    this.state.runs.push(run); this.executeAI(run); return run;
  };
  u.executeAI = function(run) {
    this.defer(()=>startAttempt(run),240);
    this.defer(()=>{
      const message = this.message(run.messageId), version = this.version(run.taskId,run.taskVersionId);
      if (!message || message.contentState !== 'available') {
        run.status = 'failed'; run.error = { code: 'SOURCE_CONTENT_UNAVAILABLE', message: '原邮件内容已不可用，无法执行此任务。', retryable: false, action: 'none' }; finishAttempt(run); return;
      }
      const existing = this.state.results.find(r=>r.messageId === message.id && r.taskVersionId === version.id);
      if (existing) { run.resultId = existing.id; run.status = 'succeeded'; finishAttempt(run); return; }
      const definition = version.definition, output = D.outputFor(version.template,message,definition.templateOptions);
      const result = { id: this.id('res'), revision: 1, status: 'ready', mailboxId: message.mailboxId, messageId: message.id, taskId: run.taskId, taskVersionId: version.id, aiTaskRunId: run.id, template: version.template, outputSchemaVersion: version.outputSchemaVersion, output,
        draft: version.template === 'reply_draft' ? { subject: output.subject, bodyText: output.bodyText, editedAt: null } : null, warnings: [], createdAt: this.now(), updatedAt: this.state.clock };
      this.state.results.push(result); run.resultId = result.id; run.status = 'succeeded'; finishAttempt(run);
    },1100);
  };
  u.ingest = function(message) {
    this.state.messages.push(message);
    let queued = 0;
    this.state.bindings.filter(b=>b.mailboxId === message.mailboxId && b.enabled && new Date(message.ingestedAt) >= new Date(b.effectiveFrom)).forEach(binding=>{
      const task = this.task(binding.taskId);
      if (task.enabled && matches(task.definition,message) && message.contentState === 'available') { this.enqueueAI(message,task); queued++; }
    });
    return queued;
  };
  u.executeSync = function(run) {
    const mailbox = this.account(run.mailboxId); mailbox.activeSyncRunId = run.id;
    this.defer(()=>startAttempt(run),200);
    this.defer(()=>{
      if (!this.state.incomingConsumed.includes(mailbox.id)) {
        const message = D.clone(D.seed().messages[0]);
        message.id = this.id('msg'); message.mailboxId = mailbox.id; message.receivedAt = this.now(3); message.ingestedAt = this.now(); message.source.provider = mailbox.provider;
        message.subject = '新来信（演示）· 周五产品评审准备事项';
        this.state.incomingConsumed.push(mailbox.id);
        run.progress.scanned++; run.progress.persisted++; run.progress.aiRunsQueued += this.ingest(message);
      }
      run.status = 'succeeded'; run.error = null; mailbox.connectionState = 'connected'; mailbox.lastError = null;
      mailbox.lastCheckedAt = this.now(); mailbox.lastSuccessfulSyncAt = mailbox.lastCheckedAt; mailbox.activeSyncRunId = null;
      mailbox.nextSyncAt = mailbox.syncPolicy.enabled ? this.later(mailbox.syncPolicy.intervalSeconds) : null; finishAttempt(run);
    },900);
  };
  u.syncNow = function(mailboxId) {
    const mailbox = this.account(mailboxId);
    if (!mailbox) return;
    if (mailbox.connectionState === 'auth_required') { this.toast('先恢复邮箱授权，再重新提交运行。'); this.openMailbox(mailboxId,'reauthorize'); return; }
    if (mailbox.connectionState === 'untested') { this.openMailbox(mailboxId,'reauthorize'); return; }
    const active = this.state.runs.find(r=>r.kind === 'sync' && r.mailboxId === mailboxId && ['queued','running','waiting_retry'].includes(r.status));
    if (active) { this.openRun(active.id); this.toast('该邮箱已有运行，继续查看同一条记录。'); return; }
    const first = mailbox.syncPolicy.activatedAt === null;
    if (first) mailbox.syncPolicy.activatedAt = this.now();
    const run = D.run(this.id('sync'),'sync',{ mailboxId, status: 'queued', phase: first ? 'initializing' : 'incremental', trigger: 'manual', attempt: 0, createdAt: this.now(), startedAt: null, finishedAt: null, attempts: [], progress: { scanned: 0, persisted: 0, duplicates: 0, ignoredHistorical: 0, unavailable: 0, quarantined: 0, aiRunsQueued: 0, hasMore: false } });
    this.state.runs.push(run); this.executeSync(run); this.view = 'runs'; this.runFilter = { kind: '', mailboxId: '', status: '' }; this.render(); this.openRun(run.id);
  };
  u.retryRun = function(id) {
    const run = this.run(id), mailbox = run && this.account(run.mailboxId);
    if (!run || !['failed','partial'].includes(run.status)) return this.toast('当前状态无需另开重试。');
    if (mailbox.connectionState === 'auth_required') { this.openMailbox(mailbox.id,'reauthorize'); return; }
    if (!run.error?.retryable && run.error?.action !== 'reauthorize_mailbox') return this.toast('请先处理配置或邮件身份问题。');
    if (run.kind === 'sync') {
      const newer = this.state.runs.find(r=>r.kind === 'sync' && r.mailboxId === run.mailboxId && new Date(r.createdAt) > new Date(run.createdAt));
      if (newer) { this.openRun(newer.id); this.toast('已有更新的同步记录，转到该运行。'); return; }
    }
    run.status = 'queued'; run.finishedAt = null; run.nextAttemptAt = null; run.waitReason = null; run.error = null;
    this.openRun(run.id); if (run.kind === 'ai') this.executeAI(run); else this.executeSync(run); refresh(run);
    this.toast('已重试原运行，保留历史尝试与原任务版本。');
  };
  u.runMessage = function(messageId) {
    const task = this.task(document.querySelector('#manual-task').value), message = this.message(messageId);
    if (!task || !message || message.contentState !== 'available') return;
    const existing = this.state.runs.find(r=>r.kind === 'ai' && r.messageId === messageId && r.taskVersionId === task.currentVersion.id);
    if (existing) { if (existing.resultId) this.showResult(existing.resultId); else this.openRun(existing.id); this.toast('此邮件的这个版本已有运行，已打开原记录。'); return; }
    const run = this.enqueueAI(message,task,'manual'); this.render(); this.openRun(run.id);
  };
  u.resolveRecovery = function(id, keepSeparate) {
    const item = this.state.recoveryItems.find(r=>r.id === id);
    if (!item || item.status !== 'pending') return;
    if (keepSeparate) {
      const message = D.clone(this.message(item.candidateMessageIds[0])); message.id = this.id('msg'); message.bodyText = item.bodyText; message.ingestedAt = this.now();
      item.status = 'kept_separate'; item.messageId = message.id; this.ingest(message);
    } else { item.status = 'linked'; item.messageId = item.candidateMessageIds[0]; }
    this.render(); this.renderModal(); this.toast(keepSeparate ? '已保留为独立邮件，并按当前绑定安排任务。' : '已关联已有邮件，没有重复生成 AI 结果。');
  };
  u.saveDraft = function(id) {
    const result = this.result(id), editor = this.editor(result);
    if (this.forceConflict) { this.forceConflict = false; result.revision++; result.status = 'edited'; result.draft.bodyText += '\n\n（另一处保存的演示修改）'; result.draft.editedAt = this.now(); }
    if (result.revision !== editor.revision) { editor.conflict = true; this.render(); this.toast('草稿版本冲突，你的未保存文字已保留。'); return; }
    if (!editor.dirty) return this.toast('草稿没有未保存的修改。');
    result.draft = { subject: editor.subject, bodyText: editor.bodyText, editedAt: this.now() }; result.status = 'edited'; result.revision++; result.updatedAt = this.state.clock;
    editor.revision = result.revision; editor.dirty = false; editor.conflict = false; this.render(); this.toast('草稿修改已保存，模型原始输出保持不变。');
  };
  u.copyText = async function(text, note = '') {
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(text); this.toast('已复制' + (note ? '；' + note : '。')); }
    catch { this.openModal({ type: 'copy', text }); this.defer(()=>document.querySelector('#manual-copy')?.select(),30); this.toast('自动复制不可用，文字已保留供手动复制。'); }
  };
  const actions = {
    navigate: el => u.navigate(el.dataset.view),
    'go-config': () => { u.closeModal(); u.configTab = 'mailboxes'; u.navigate('config'); },
    'go-results': () => { u.closeModal(); u.resultFilter = { mailboxId: '', template: '', taskId: '', time: '' }; u.navigate('results'); },
    'config-tab': el => { u.configTab = el.dataset.id; u.render(); },
    'new-mailbox': () => u.openMailbox(), 'mailbox-settings': el => u.openMailbox(el.dataset.id), reauthorize: el => u.openMailbox(el.dataset.id,'reauthorize'),
    'close-modal': () => u.closeModal(),
    'select-provider': el => { u.modal.draft.provider = el.dataset.id; u.modal.draft.connectionState = el.dataset.id === 'imap' ? 'untested' : 'auth_required'; if (el.dataset.id !== 'imap') delete u.modal.draft.imap; else u.modal.draft.imap = { host: 'imap.example.test', port: 993, security: 'tls', username: u.modal.draft.accountEmail }; u.renderModal(); },
    'mailbox-next': () => { u.captureMailbox(); if (u.modal.step === 1 || u.modal.test?.status === 'succeeded') { u.modal.step++; u.renderModal(); } },
    'mailbox-back': () => { u.captureMailbox(); u.modal.step--; u.renderModal(); },
    'mailbox-test-step': () => { u.captureMailbox(); u.modal.step = 2; u.modal.test = null; u.renderModal(); },
    'test-mailbox': () => u.testMailbox(),
    'toggle-sync': el => { const m = u.account(el.dataset.id); if (!m.syncPolicy.enabled && m.connectionState !== 'connected') { u.openMailbox(m.id,'reauthorize'); return; } m.syncPolicy.enabled = !m.syncPolicy.enabled; if (m.syncPolicy.enabled && !m.syncPolicy.activatedAt) m.syncPolicy.activatedAt = u.now(); m.nextSyncAt = m.syncPolicy.enabled ? u.later(m.syncPolicy.intervalSeconds) : null; m.revision++; u.render(); u.toast(m.syncPolicy.enabled ? '已开启模拟定时检查。' : '已暂停定时检查；连接状态不变，仍可手动运行。'); },
    'new-service': () => u.openService(), 'edit-service': el => u.openService(el.dataset.id),
    'test-service': el => { u.openService(el.dataset.id); u.testService(); }, 'test-service-modal': () => u.testService(),
    'new-task': () => u.openTask(), 'edit-task': el => u.openTask(el.dataset.id),
    'select-template': el => { const t = u.template(el.dataset.id); Object.assign(u.modal.draft, { name: t.name }); Object.assign(u.modal.draft.definition, { template: t.id, instructions: t.instructions, templateOptions: D.clone(t.options) }); u.renderModal(); },
    'task-next': () => { u.modal.step = 2; u.renderModal(); }, 'task-back': () => { u.captureTask(); u.modal.step = 1; u.modal.preview = false; u.renderModal(); },
    'preview-task': () => { if (!valid('task-form')) return; u.captureTask(); u.modal.preview = true; u.renderModal(); },
    'add-field': () => { u.captureTask(); u.modal.draft.definition.templateOptions.fields.push({ name: 'field' + (u.modal.draft.definition.templateOptions.fields.length + 1), type: 'string' }); u.renderModal(); },
    'remove-field': el => { u.captureTask(); u.modal.draft.definition.templateOptions.fields.splice(Number(el.dataset.id),1); u.renderModal(); },
    'toggle-task': el => { const task = u.task(el.dataset.id); task.enabled = !task.enabled; task.revision++; u.render(); u.toast('任务开关已更新，仅影响后续入库的邮件。'); },
    'sync-now': el => u.syncNow(el.dataset.id), 'run-picker': () => u.openModal({ type: 'picker' }),
    'run-detail': el => u.openRun(el.dataset.id), 'retry-run': el => u.retryRun(el.dataset.id),
    'select-result': el => { u.selectedResultId = el.dataset.id; u.mobileDetail = true; u.readingTab = 'result'; u.render(); if (matchMedia('(max-width:650px)').matches) window.scrollTo({ top: 170, behavior: 'instant' }); },
    'back-results': () => { u.mobileDetail = false; u.render(); },
    'reading-tab': el => { u.readingTab = el.dataset.id; u.render(); },
    'clear-result-filters': () => { u.resultFilter = { mailboxId: '', template: '', taskId: '', time: '' }; u.render(); },
    'show-ai-failures': () => { u.runFilter = { kind: 'ai', mailboxId: '', status: 'failed' }; u.navigate('runs'); },
    'open-result': el => { u.closeModal(); u.showResult(el.dataset.id); }, 'run-message': el => u.runMessage(el.dataset.id),
    'save-draft': el => u.saveDraft(el.dataset.id),
    'copy-draft': el => { const editor = u.editor(u.result(el.dataset.id)); u.copyText(editor.bodyText,editor.dirty ? '当前修改尚未保存' : ''); },
    'copy-draft-full': el => { const editor = u.editor(u.result(el.dataset.id)); u.copyText('主题：' + editor.subject + '\n\n' + editor.bodyText,editor.dirty ? '当前修改尚未保存' : ''); },
    'resolve-draft-conflict': el => { const result = u.result(el.dataset.id), editor = u.editor(result); editor.revision = result.revision; editor.conflict = false; u.render(); u.toast('已保留你的文字，可在核对后保存。'); },
    'reload-draft': el => { delete u.editors[el.dataset.id]; u.render(); u.toast('已采用最新保存的草稿。'); },
    'export-result': el => { const result = u.result(el.dataset.id); const url = URL.createObjectURL(new Blob([JSON.stringify({ demonstration: true, ...result },null,2)],{ type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'mail-ai-demo-' + result.id + '.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); u.toast('已导出本地演示结果。'); },
    'open-recovery': el => u.openRecovery(el.dataset.id), 'resolve-recovery-link': el => u.resolveRecovery(el.dataset.id,false), 'resolve-recovery-separate': el => u.resolveRecovery(el.dataset.id,true),
    reset: () => u.reset(u.state.scenario),
    'advance-retry': () => { const run = u.state.runs.find(r=>r.status === 'waiting_retry'); if (!run) return; u.state.clock = run.nextAttemptAt; run.status = 'queued'; run.nextAttemptAt = null; run.waitReason = null; run.error = null; if (run.kind === 'ai') u.executeAI(run); else u.executeSync(run); refresh(run); u.toast('演示时间已推进，原运行继续重试。'); }
  };
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
    const action = actions[el.dataset.action]; if (!action) return;
    event.preventDefault(); action(el);
  });
  document.addEventListener('submit', event => {
    const kind = event.target.dataset.form; if (!kind) return; event.preventDefault();
    if (kind === 'mailbox') u.saveMailbox(); if (kind === 'service') u.saveService(); if (kind === 'task') u.saveTask();
    if (kind === 'run-picker') { const id = data('run-picker-form').get('run-mailbox'); u.closeModal(); u.syncNow(String(id)); }
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.id === 'demo-scenario') { u.reset(el.value); return; }
    if (el.id === 'appearance') { document.body.dataset.appearance = el.value; document.body.dataset.theme = el.value === 'graphite' ? 'graphite' : 'paper'; document.body.dataset.density = el.value === 'compact' ? 'compact' : 'standard'; return; }
    if (el.id === 'test-outcome') { u.testOutcome = el.value; return; }
    if (el.dataset.filter) { u.resultFilter[el.dataset.filter] = el.value; u.mobileDetail = false; u.render(); document.getElementById(el.id)?.focus({ preventScroll: true }); }
    if (el.dataset.runFilter) { u.runFilter[el.dataset.runFilter] = el.value; if (u.runFilter.kind === 'ai' && u.runFilter.status === 'partial') u.runFilter.status = ''; u.render(); document.getElementById(el.id)?.focus({ preventScroll: true }); }
  });
  document.addEventListener('input', event => {
    const el = event.target;
    if (el.dataset.draftField) { const result = u.result(el.dataset.resultId), editor = u.editor(result); editor[el.dataset.draftField] = el.value; editor.dirty = editor.subject !== result.draft.subject || editor.bodyText !== result.draft.bodyText; document.querySelector('#draft-status').textContent = editor.dirty ? '有未保存的修改' : '没有未保存的修改'; }
  });
  document.addEventListener('keydown', event => {
    const dialog = document.querySelector('#modal');
    if (event.key === 'Tab' && dialog.open) {
      const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const first = focusable[0], last = focusable.at(-1);
      if (!dialog.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return;
      }
    }
    const tabs = event.target.closest('[role="tablist"]');
    if (tabs && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      const elements = Array.from(tabs.querySelectorAll('[role="tab"]')); const i = elements.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? elements.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + elements.length) % elements.length;
      event.preventDefault(); const selected = elements[next], action = selected.dataset.action, id = selected.dataset.id; selected.click(); document.querySelector(`[data-action="${action}"][data-id="${id}"]`)?.focus({ preventScroll: true });
    }
  });
  document.querySelector('#modal').addEventListener('cancel', event => { event.preventDefault(); u.closeModal(); });
  u.reset('daily'); window.__ready = true;
})();
