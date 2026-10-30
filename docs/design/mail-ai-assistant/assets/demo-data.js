/* 全部为合成演示数据。字段与 api-contract.md v0.2 对齐；模拟范围见 ui-design.md。 */
(() => {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const at = minute => '2026-10-29T02:' + String(minute).padStart(2, '0') + ':00Z';
  const templates = [
    { id: 'summary', name: '邮件摘要', short: '摘要', mark: '摘', stage: 'M1', description: '先读重点，再决定下一步。', instructions: '用中文概括重点，保留未知信息，不推测邮件未说明的事项。', options: { language: 'zh-CN' } },
    { id: 'classification', name: '邮件分类', short: '分类', mark: '类', stage: 'M2', description: '按你定义的标签整理来信。', instructions: '从配置的标签中选择最合适的一项，并说明理由。', options: { categories: ['项目协作', '财务', '订阅'] } },
    { id: 'todo_extraction', name: '提取待办', short: '待办', mark: '办', stage: 'M2', description: '把行动、负责人和日期列清楚。', instructions: '提取明确的行动，引用原文；未说明的负责人或日期保持未知。', options: { language: 'zh-CN' } },
    { id: 'field_extraction', name: '提取字段', short: '字段', mark: '栏', stage: 'M2', description: '把票号、金额等内容变成字段。', instructions: '只提取原文明确出现的字段，未找到的值保留为空。', options: { fields: [{ name: 'invoiceNumber', type: 'string' }, { name: 'amount', type: 'number' }, { name: 'currency', type: 'string' }] } },
    { id: 'translation', name: '邮件翻译', short: '翻译', mark: '译', stage: 'M2', description: '用熟悉的语言阅读邮件正文。', instructions: '忠实翻译正文，保留数字、人名和专有名词。', options: { targetLanguage: 'zh-CN' } },
    { id: 'reply_draft', name: '回复草稿', short: '草稿', mark: '回', stage: 'M2', description: '准备一封可编辑的回复。', instructions: '用礼貌、简洁的语气起草回复；未经确认的时间和承诺用询问表达。', options: { language: 'zh-CN' } }
  ];
  const capabilities = {
    executionMode: 'simulated',
    mailboxProviders: [
      { id: 'imap', stage: 'M1', implementationStatus: 'planned', available: false },
      { id: 'gmail', stage: 'M2', implementationStatus: 'planned', available: false },
      { id: 'graph', stage: 'M2', implementationStatus: 'planned', available: false }
    ],
    aiAdapters: [{ id: 'deployment_default', available: false }],
    taskTemplates: templates.map(t => t.id), availableTaskTemplates: [],
    limits: { minIntervalSeconds: 60, maxIntervalSeconds: 86400, maxPageSize: 100 },
    features: { historyImport: false, attachmentContent: false, reports: false, mailSending: false }
  };
  const providers = {
    imap: { name: '通用 IMAP', description: '支持 IMAP 的个人或企业邮箱', stage: 'M1', image: null },
    gmail: { name: 'Gmail', description: '官方授权 · Gmail API', stage: 'M2', image: 'assets/brands/gmail.ico' },
    graph: { name: 'Microsoft Outlook', description: '官方授权 · Microsoft Graph', stage: 'M2', image: 'assets/brands/microsoft.ico' }
  };
  function mailbox(id, name, email, provider, enabled = true) {
    return { id, revision: 1, name, accountEmail: email, provider, connectionState: 'connected', credentialConfigured: true,
      ...(provider === 'imap' ? { imap: { host: 'imap.example.test', port: 993, security: 'tls', username: email } } : {}),
      syncPolicy: { enabled, intervalSeconds: 300, folders: ['inbox'], activatedAt: at(0) },
      lastCheckedAt: at(30), lastSuccessfulSyncAt: at(30), nextSyncAt: enabled ? at(35) : null, activeSyncRunId: null, lastError: null };
  }
  function task(template, index) {
    const definition = { template: template.id, instructions: template.instructions,
      matching: { senderDomains: [], subjectContainsAny: [], hasAttachments: null },
      aiServiceId: 'ais_demo', aiServiceConfigVersionId: 'aicfg_demo_v1', model: 'demo-model',
      modelSettings: { temperature: 0.2, maxOutputTokens: 1200 }, templateOptions: clone(template.options) };
    const version = { id: 'taskver_' + template.id + '_v1', number: 1, template: template.id,
      aiServiceId: 'ais_demo', aiServiceConfigVersionId: 'aicfg_demo_v1', model: 'demo-model',
      outputSchemaVersion: template.id + '.v1', createdAt: at(1), definition: clone(definition) };
    return { id: 'task_' + template.id, revision: 1, name: template.name, enabled: true, definition, currentVersion: version, versions: [clone(version)] };
  }
  function outputFor(template, message, options = {}) {
    const invoice = message.subject.includes('发票');
    const review = message.subject.includes('评审');
    switch (template) {
      case 'summary': return { summary: review ? '10 月 30 日 15:00 进行原型评审。林予需要补齐移动端流程，接口部分的负责人尚待确认。' : invoice ? '本期服务发票已开具：票号 INV-1029，金额 3,200 元。邮件未说明付款截止日期。' : '这封演示邮件介绍了本周的产品更新，并邀请收件人提供反馈。', keyPoints: review ? ['评审时间：10 月 30 日 15:00', '林予负责补齐移动端流程', '接口负责人尚未提供'] : ['保留邮件中明确的信息', '未说明的事项保持未知'], language: 'zh-CN' };
      case 'classification': {
        const intended = invoice ? '财务' : review ? '项目协作' : '订阅';
        const category = (options.categories || []).includes(intended) ? intended : null;
        return { category, confidence: category ? 0.96 : null, reason: category ? '邮件主题与正文明确涉及' + category + '事项。' : '示例邮件未匹配配置的分类，保留为未知。' };
      }
      case 'todo_extraction': return { items: review ? [
        { text: '补齐移动端操作流程', owner: '林予', dueDate: '2026-10-30', sourceQuote: '请林予在 10 月 30 日前补齐移动端流程。' },
        { text: '确认接口部分的负责人', owner: null, dueDate: null, sourceQuote: '接口部分的负责人暂未确定，请协助确认。' }
      ] : [] };
      case 'field_extraction': {
        const known = invoice ? { invoiceNumber: 'INV-1029', amount: 3200, currency: 'CNY' } : {};
        return { fields: Object.fromEntries((options.fields || []).map(field => [field.name, known[field.name] ?? null])) };
      }
      case 'translation': return { targetLanguage: options.targetLanguage || 'zh-CN', translatedText: options.targetLanguage === 'en' ? 'This is a sample translation. Please review the original email before using it.' : '大家好，\n\n本周的更新已准备就绪。我们改进了收件箱筛选，并优化了阅读体验。欢迎在周五前分享反馈。\n\n产品团队（演示）' };
      case 'reply_draft': return { subject: 'Re: ' + message.subject, bodyText: '你好，\n\n收到评审安排。我会核对移动端流程，也想确认一下接口部分由谁负责，方便一起准备。\n\n谢谢！', language: 'zh-CN' };
      default: return {};
    }
  }
  function run(id, kind, props = {}) {
    return { id, kind, mailboxId: 'mbx_work', status: 'succeeded', trigger: kind === 'sync' ? 'schedule' : 'message_ingest',
      attempt: 1, createdAt: at(30), startedAt: at(30), finishedAt: at(31), nextAttemptAt: null, waitReason: null,
      error: null, attempts: [{ number: 1, startedAt: at(30), finishedAt: at(31), status: 'succeeded', error: null }],
      ...(kind === 'sync' ? { phase: 'incremental', progress: { scanned: 2, persisted: 2, duplicates: 0, ignoredHistorical: 0, unavailable: 0, quarantined: 0, aiRunsQueued: 5, hasMore: false } } : { resultId: null }), ...props };
  }
  function seed(scenario = 'daily') {
    const state = { scenario, clock: at(35), capabilities: clone(capabilities), mailboxes: [], services: [], tasks: [], bindings: [], messages: [], runs: [], results: [], recoveryItems: [], tests: [], incomingConsumed: [], counter: 10 };
    if (scenario === 'empty') return state;
    state.mailboxes = [mailbox('mbx_work', '工作邮箱', 'work@example.test', 'imap'), mailbox('mbx_news', '订阅邮箱', 'letters@example.test', 'gmail', false)];
    state.services = [{ id: 'ais_demo', revision: 1, configVersionId: 'aicfg_demo_v1', name: '默认 AI 服务', adapterId: 'deployment_default', baseUrl: 'https://ai.example.test/v1', defaultModel: 'demo-model', credentialConfigured: true, connectionState: 'connected', lastTestedAt: at(0), lastError: null }];
    state.tasks = templates.map(task);
    state.bindings = state.tasks.map((t, i) => ({ id: 'bind_' + i, revision: 1, mailboxId: t.definition.template === 'translation' ? 'mbx_news' : 'mbx_work', taskId: t.id, enabled: true, effectiveFrom: at(1), appliesTo: 'future_ingest' }));
    state.messages = [
      { id: 'msg_review', mailboxId: 'mbx_work', subject: '周五产品评审 · 请确认准备事项', from: { name: '陈遥（演示）', address: 'chenyao@example.test' }, receivedAt: at(20), ingestedAt: at(30), contentState: 'available',
        bodyText: '大家好，\n\n我们将在 10 月 30 日 15:00 进行原型评审。\n\n请林予在 10 月 30 日前补齐移动端流程。接口部分的负责人暂未确定，请协助确认。\n\n议程见附件。若有需要调整的内容，请在会议前留言。\n\n陈遥\n产品团队\n\n—— 本邮件为合成演示数据 ——', attachments: [{ id: 'att_agenda', filename: '评审议程.pdf', contentType: 'application/pdf', sizeBytes: 24576, contentProcessing: 'not_supported' }], source: { provider: 'imap', folderRole: 'inbox', remoteState: 'present' } },
      { id: 'msg_invoice', mailboxId: 'mbx_work', subject: '10 月服务发票已开具', from: { name: '财务小组（演示）', address: 'finance@example.test' }, receivedAt: at(16), ingestedAt: at(30), contentState: 'available', bodyText: '你好，\n\n10 月服务发票已开具。\n票号：INV-1029\n金额：3200\n币种：CNY\n\n付款截止日期将在后续通知。\n\n—— 合成演示数据 ——', attachments: [], source: { provider: 'imap', folderRole: 'inbox', remoteState: 'present' } },
      { id: 'msg_news', mailboxId: 'mbx_news', subject: 'A quieter inbox, a clearer week', from: { name: 'Product notes（演示）', address: 'notes@example.test' }, receivedAt: at(10), ingestedAt: at(30), contentState: 'available', bodyText: 'Hello,\n\nThis week’s update is ready. We improved inbox filters and made reading a little easier. Please share your feedback by Friday.\n\nThe product team\n\n— Synthetic demonstration message —', attachments: [], source: { provider: 'gmail', folderRole: 'inbox', remoteState: 'present' } }
    ];
    state.runs.push(run('sync_work', 'sync'), run('sync_news', 'sync', { mailboxId: 'mbx_news', progress: { scanned: 1, persisted: 1, duplicates: 0, ignoredHistorical: 0, unavailable: 0, quarantined: 0, aiRunsQueued: 1, hasMore: false } }));
    const sources = { summary: 'msg_review', classification: 'msg_invoice', todo_extraction: 'msg_review', field_extraction: 'msg_invoice', translation: 'msg_news', reply_draft: 'msg_review' };
    state.tasks.forEach(t => {
      const type = t.definition.template, message = state.messages.find(m => m.id === sources[type]);
      const output = outputFor(type, message, t.definition.templateOptions), id = 'res_' + type, runId = 'airun_' + type;
      state.runs.push(run(runId, 'ai', { mailboxId: message.mailboxId, messageId: message.id, taskId: t.id, taskVersionId: t.currentVersion.id, resultId: id }));
      state.results.push({ id, revision: 1, status: 'ready', mailboxId: message.mailboxId, messageId: message.id, taskId: t.id, taskVersionId: t.currentVersion.id, aiTaskRunId: runId, template: type, outputSchemaVersion: type + '.v1', output, draft: type === 'reply_draft' ? { subject: output.subject, bodyText: output.bodyText, editedAt: null } : null, warnings: [], createdAt: at(31), updatedAt: at(31) });
    });
    const work = state.mailboxes[0];
    if (scenario === 'auth') {
      const error = { code: 'MAILBOX_AUTH_REQUIRED', message: '邮箱授权已失效，请重新授权后重试。', retryable: false, action: 'reauthorize_mailbox' };
      Object.assign(work, { connectionState: 'auth_required', lastError: error, nextSyncAt: null });
      state.runs.unshift(run('sync_auth', 'sync', { status: 'failed', error, progress: { scanned: 0, persisted: 0, duplicates: 0, ignoredHistorical: 0, unavailable: 0, quarantined: 0, aiRunsQueued: 0, hasMore: false } }));
    }
    if (scenario === 'sync_failure') {
      const error = { code: 'MAILBOX_NETWORK_ERROR', message: '连接邮箱服务器超时，自动重试已用尽。请检查连接后重试。', retryable: true, action: 'retry_run' };
      Object.assign(work, { connectionState: 'error', lastError: error });
      state.runs.unshift(run('sync_failed', 'sync', { status: 'failed', attempt: 5, error, progress: { scanned: 0, persisted: 0, duplicates: 0, ignoredHistorical: 0, unavailable: 0, quarantined: 0, aiRunsQueued: 0, hasMore: false } }));
    }
    if (scenario === 'task_failure' || scenario === 'waiting') {
      state.results = state.results.filter(r => r.template !== 'todo_extraction');
      const target = state.runs.find(r => r.id === 'airun_todo_extraction');
      Object.assign(target, { resultId: null, status: scenario === 'waiting' ? 'waiting_retry' : 'failed', attempt: 3, finishedAt: scenario === 'waiting' ? null : at(34),
        nextAttemptAt: scenario === 'waiting' ? at(36) : null, waitReason: scenario === 'waiting' ? 'rate_limit' : null,
        error: { code: scenario === 'waiting' ? 'AI_RATE_LIMITED' : 'AI_SERVICE_TIMEOUT', message: scenario === 'waiting' ? 'AI 服务暂时限流，已安排稍后重试。' : '提取待办时 AI 服务超时。其他任务的结果已保留。', retryable: true, action: scenario === 'waiting' ? 'wait' : 'retry_run' } });
    }
    if (scenario === 'no_new') {
      state.messages = []; state.results = []; state.runs = [run('sync_zero', 'sync', { progress: { scanned: 0, persisted: 0, duplicates: 0, ignoredHistorical: 0, unavailable: 0, quarantined: 0, aiRunsQueued: 0, hasMore: false } })];
      state.incomingConsumed = state.mailboxes.map(m => m.id);
    }
    if (scenario === 'recovery') {
      const error = { code: 'DEDUP_REVIEW_REQUIRED', message: '邮箱重建了邮件编号，有 1 封邮件需要确认身份。已保存的内容保留。', retryable: false, action: 'review_recovery' };
      state.runs.unshift(run('sync_recovery', 'sync', { status: 'partial', phase: 'recovering', error }));
      state.recoveryItems = [{ id: 'recovery_review', status: 'pending', mailboxId: 'mbx_work', reason: 'identity_ambiguous', candidateMessageIds: ['msg_review'], receivedAt: at(20), subject: state.messages[0].subject, bodyText: state.messages[0].bodyText, createdAt: at(34) }];
    }
    state.runs.forEach(r => {
      r.attempts = [{ number: r.attempt, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, error: clone(r.error) }];
    });
    return state;
  }
  window.MailDemoData = { clone, templates, capabilities, providers, mailbox, outputFor, run, seed };
})();
