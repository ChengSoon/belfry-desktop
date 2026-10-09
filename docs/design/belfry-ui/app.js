'use strict';
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    workspace:'M3 4h18v16H3z M3 9h18 M9 9v11', projects:'M3 6h7l2 2h9v12H3z M3 6V4h7l2 2',
    ssh:'M4 5h16v12H4z M8 21h8 M12 17v4 M7 9l3 2-3 2 M12 13h4',
    collab:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-4 M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    files:'M6 2h8l4 4v16H6z M14 2v5h5 M9 12h6 M9 16h6', history:'M3 11a9 9 0 1 1 3 8 M3 4v7h7 M12 7v5l3 2',
    usage:'M4 20V10 M10 20V4 M16 20V8 M22 20H2', plugins:'M8 3h8v5h5v8h-5v5H8v-5H3V8h5z',
    settings:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
    search:'M11 3a8 8 0 1 1 0 16 8 8 0 0 1 0-16 M17 17l4 4', plus:'M12 4v16 M4 12h16', close:'M6 6l12 12 M18 6L6 18',
    moon:'M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11', sun:'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
    sidebar:'M3 4h18v16H3z M8 4v16', split:'M3 4h18v16H3z M12 4v16', arrow:'M5 12h14 M14 7l5 5-5 5',
    check:'M4 12l5 5L20 6', chevron:'M9 5l7 7-7 7', terminal:'M4 4h16v16H4z M7 8l4 4-4 4 M13 16h4',
    key:'M15 3a6 6 0 1 1-4 10L3 21H1v-4l8-8a6 6 0 0 1 6-6', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
    backup:'M3 5h18v4H3z M5 9v12h14V9 M9 13h6', keyboard:'M2 5h20v14H2z M6 9h1 M11 9h1 M16 9h1 M6 13h1 M11 13h1 M16 13h1 M7 16h10',
    environment:'M3 12h4l3-8 4 16 3-8h4', about:'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18 M12 11v6 M12 7v1', update:'M3 9a9 9 0 0 1 15-5l3 3 M21 2v5h-5 M21 15a9 9 0 0 1-15 5l-3-3 M3 22v-5h5'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.settings}"/></svg>`;
  const btn = (label, action, cls = '', extra = '') => `<button type="button" class="button ${cls}" data-action="${action}" ${extra}>${label}</button>`;
  const routeBtn = (route, label, glyph = route, extra = '') => {
    const active = state.route === route || (route === 'settings' && state.route.startsWith('settings/'));
    return `<button type="button" class="nav-item ${active ? 'active' : ''}" data-route="${route}" aria-current="${active ? 'page' : 'false'}" ${extra}>${icon(glyph)}<span>${label}</span></button>`;
  };
  const badge = (label, cls = '') => `<span class="badge ${cls}">${label}</span>`;
  const settings = [
    ['appearance','外观','sun','工作环境'],['shortcuts','快捷键','keyboard'],
    ['provider','全局 Provider','key','Agent 与连接'],['project-provider','项目 Provider','projects'],['agent-hooks','会话状态','environment'],['background-sessions','后台会话','terminal'],
    ['plugins','插件','plugins','扩展'],['backup','本地备份','backup','数据与安全'],
    ['environment','协作环境','environment','帮助与诊断'],['about','关于 Belfry','about'],['update','更新','update']
  ];
  const nav = [['workspace','工作台'],['projects','项目与工作区'],['ssh','SSH 连接'],['collab','协作'],['files','文件与 Git'],['history','会话历史'],['usage','用量'],['plugins','插件中心']];
  const state = {
    route:'workspace', theme:'dark', variant:'graphite', sidebar:true, queue:true, split:true, project:0, session:0,
    workspace:'日常开发', workspaces:['日常开发','文档维护'], projects:[{name:'belfry',path:'~/Projects/belfry',branch:'ui/refinement',kind:'本地项目'},{name:'docs-site',path:'~/Projects/docs-site',branch:'main',kind:'本地项目'},{name:'remote-lab',path:'/srv/demo/remote-lab',branch:'demo',kind:'SSH · 未连接'}],
    sessions:[{name:'界面细节审查',agent:'Claude Code',status:'等待确认',project:0},{name:'Shell 01',agent:'Shell',status:'空闲',project:0},{name:'文档结构整理',agent:'Codex',status:'进行中 · 样例',project:1}],
    collabFilter:'waiting', collabs:[{title:'界面细节审查',agent:'Claude Code',summary:'已整理导航层级与键盘焦点的建议，等待你决定是否采纳。',status:'waiting'},{title:'文档结构整理',agent:'Codex',summary:'正在整理文档目录。此状态为静态演示，不代表真实 Agent。',status:'running'},{title:'终端配色对比',agent:'Claude Code',summary:'样例审查已结束，建议保留高对比输出。',status:'done'}],
    search:{projects:'',history:'',plugins:''}, historyProject:'all', historySource:'all', historyEmpty:false,
    history:[{name:'导航可访问性检查',project:'belfry',agent:'Claude Code',time:'今天 10:42',detail:'12 条消息 · 24 分钟'},{name:'构建日志整理',project:'belfry',agent:'Shell',time:'昨天 16:08',detail:'Shell 输出 · 8 分钟'},{name:'文档首页修订',project:'docs-site',agent:'Codex',time:'昨天 09:31',detail:'8 条消息 · 18 分钟'}],
    file:'Workbench.tsx', preview:false, fileMode:'diff', usageRange:'7', usageScope:'all', pluginTab:'installed',
    plugins:[{id:'notes',name:'Workspace Notes',description:'在工作台中查看项目笔记。',version:'0.3.0',installed:true,enabled:true,permissions:'读取演示项目文件；保存插件自己的笔记。',source:'本地示例清单 · notes.example.invalid'}, {id:'git',name:'Git Companion',description:'查看分支与改动摘要。',version:'0.2.1',installed:true,enabled:false,permissions:'读取项目 Git 元数据；不自动提交。',source:'本地示例清单 · git.example.invalid'}, {id:'outline',name:'Document Outline',description:'提取文档标题并定位章节。',version:'0.1.0',installed:false,enabled:false,permissions:'读取选中的文档。',source:'市场演示清单 · plugins.example.invalid'}],
    agent:'Claude Code', providers:[{id:'official',name:'官方服务',endpoint:'https://api.example.invalid/v1',configured:true,selected:true},{id:'custom',name:'自定义服务',endpoint:'https://gateway.example.invalid/v1',configured:false,selected:false}],
    hooks:true, background:true, projectOverride:false, backups:[{name:'工作环境 · 示例备份',time:'2026-05-18 09:00',detail:'外观、快捷键、项目索引 · 不含凭据'}], sshStatus:'idle', updateStatus:'idle'
  };
  // Key text exists only in the live form. Debug state never contains credential values.
  let editor = null, modalKind = '', returnFocus = null, pendingLeave = null, toastTimer, quickIndex = 0, quickItems = [];
  const modal = $('#modal'), confirmation = $('#confirm-modal');
  state.providerSets = {};
  state.projectOverrides = {};
  state.sshHosts = [
    {name:'开发环境',host:'dev.example.invalid',port:'22',user:'demo',path:'/srv/demo',auth:'key',status:'idle',fail:false},
    {name:'离线环境',host:'offline.example.invalid',port:'2222',user:'demo',path:'/srv/demo',auth:'password',status:'idle',fail:true}
  ];
  function activeProviders() {
    const scope = state.route === 'settings/project-provider' && state.projectOverrides[project().name] ? `project:${project().name}` : 'global';
    const key = `${scope}:${state.agent}`;
    if (!state.providerSets[key]) state.providerSets[key] = (state.providerSets[`global:${state.agent}`] || state.providers).map(p => ({...p}));
    return state.providerSets[key];
  }
  const project = () => state.projects[state.project];
  const pageHeader = (title, desc, actions = '', eyebrow = '') => `<header class="page-header"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1><p>${desc}</p></div><div class="page-actions">${actions}</div></header>`;
  const empty = (title, desc, action = '') => `<div class="empty">${icon('search')}<h2>${title}</h2><p>${desc}</p>${action}</div>`;
  const searchField = (key, label) => `<label class="search-field">${icon('search')}<input type="search" data-search="${key}" value="${esc(state.search[key])}" placeholder="${label}" aria-label="${label}"></label>`;
  const options = (items, current) => items.map(([v,l]) => `<option value="${esc(v)}" ${String(current)===String(v)?'selected':''}>${esc(l)}</option>`).join('');
  const settingRow = (title, desc, control) => `<div class="setting-row"><div><h3>${title}</h3><p>${desc}</p></div>${control}</div>`;
  function renderShell() {
    $('#app').classList.toggle('sidebar-hidden', !state.sidebar && innerWidth > 760);
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.dataset.variant = state.variant;
    $('#sidebar').innerHTML = `<div class="brand"><img src="assets/belfry.png" alt=""><div><strong>Belfry</strong><small>本地优先的工作台</small></div></div>
      <nav aria-label="项目导航">${nav.slice(0,3).map(([r,l])=>routeBtn(r,l)).join('')}</nav>
      <section class="sidebar-group"><div class="group-label"><span>会话 / ${state.sessions.filter(s=>s.project===state.project).length}</span><button data-action="new-session" aria-label="新建会话">${icon('plus')}</button></div>
      ${state.sessions.map((s,i)=>s.project===state.project?`<button class="session-item ${state.session===i&&state.route==='workspace'?'active':''}" data-action="select-session" data-index="${i}" aria-pressed="${state.session===i}"><span class="session-line"><i class="dot ${s.status.includes('确认')?'amber':s.status.includes('进行')?'green':''}"></i>${esc(s.name)}</span><small>${s.agent} · ${s.status}</small></button>`:'').join('')}</section>
      <nav class="sidebar-group" aria-label="工具导航"><div class="group-label">工具</div>${nav.slice(3).map(([r,l])=>routeBtn(r,l)).join('')}</nav>
      <div class="sidebar-bottom">${routeBtn('settings','设置','settings')}<div class="group-label" style="padding-top:16px">${icon('projects')}<span>${esc(state.workspace)}</span></div></div>`;
    $('#toolbar').innerHTML = `<button class="icon-button" data-action="sidebar" data-testid="sidebar-toggle" aria-label="切换侧栏" aria-expanded="${state.sidebar}">${icon('sidebar')}</button>
      ${icon('projects')}<select class="project-select" aria-label="当前项目" data-change="project">${state.projects.map((p,i)=>`<option value="${i}" ${i===state.project?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      <span class="toolbar-divider"></span><span class="toolbar-context mono">${esc(project().branch)}</span>
      <div class="toolbar-actions"><button class="search-trigger" data-action="quick-open" data-testid="quick-open" aria-label="Quick Open">${icon('search')}<span>快速打开</span><kbd>⌘ K</kbd></button>
      <select class="variant-select" data-change="variant" data-testid="variant-select" aria-label="设计变体">${options([['graphite','Graphite'],['paper','Paper'],['compact','Compact']],state.variant)}</select>
      <button class="icon-button" data-action="theme" data-testid="theme-toggle" aria-label="${state.theme==='dark'?'切换暖白主题':'切换石墨主题'}">${icon(state.theme==='dark'?'sun':'moon')}</button>
      <button class="icon-button" data-route="settings" aria-label="设置">${icon('settings')}</button></div>`;
    $('#status-context').textContent = `${project().name} · ${state.sessions.filter(s=>s.project===state.project).length} 个演示会话`;
  }
  function render() {
    const previousFocus = document.activeElement;
    const focusSelector = previousFocus?.id ? `#${previousFocus.id}` : previousFocus?.dataset.testid ? `[data-testid="${previousFocus.dataset.testid}"]` : previousFocus?.dataset.action ? `[data-action="${previousFocus.dataset.action}"]${previousFocus.dataset.id ? `[data-id="${previousFocus.dataset.id}"]` : ''}` : previousFocus?.dataset.change ? `[data-change="${previousFocus.dataset.change}"]` : '';
    renderShell();
    const route = state.route;
    $('#content').innerHTML = route.startsWith('settings/') ? settingsView(route.split('/')[1]) : (views[route] || views.workspace)();
    if (focusSelector && !modal.open) $(focusSelector)?.focus({preventScroll:true});
    document.title = `Belfry · ${$('#content h1')?.textContent || '设计原型'}`;
  }
  function navigate(route) {
    if (route==='settings') route='settings/appearance';
    if (settings.some(s=>s[0]===route)) route=`settings/${route}`;
    if (!views[route] && !settings.some(s=>`settings/${s[0]}`===route)) { toast('此入口不在原型覆盖范围。'); return; }
    leave(() => {if(modal.open)closeModal(true);state.route=route;$('#app').classList.remove('mobile-sidebar');render();$('#content').scrollTop=0;$('#content').focus();});
  }
  function terminalPane(session, second = false) {
    const isShell = second || session.agent==='Shell';
    const output = isShell ? `<span class="command">$ git status --short</span>\n M src/components/Workbench.tsx\n M src/styles.css\n\n<span class="command">$ pnpm test -- navigation</span>\n\n<span class="accent">✓ navigation / focus order</span>\n<span class="accent">✓ navigation / route restore</span>\n\nTests   2 passed (sample)\nTime    0.42s\n<span class="terminal-rule"></span><span class="command">$ pwd</span>\n${esc(project().path)}\n\n<span class="muted">以上为固定输出样例，未执行命令。</span>` : `<span class="accent">${esc(session.agent)}</span>  /  ${esc(session.name)}\n\n<span class="command">› 检查工作台的导航层级与焦点顺序。</span>\n\n读取项目上下文…（演示）\n  Workbench.tsx\n  Sidebar.tsx\n  styles.css\n<span class="terminal-rule"></span><span class="command">审查摘要</span>\n\n1. 项目、会话与工具保持独立分组。\n2. 切换会话时保留工作台上下文。\n3. 所有弹窗应返回到原触发控件。\n\n<span class="warning">等待你的确认</span>\n建议已放入右侧队列。\n\n<span class="muted">演示会话 · 不连接真实 Agent</span>`;
    const actualOutput = !isShell && session.status !== '等待确认' ? `<span class="accent">${esc(session.agent)}</span> / ${esc(session.name)}\n\n<span class="command">${esc(session.status)}</span>\n\n这是一个合成演示会话。\n输入只在界面中展示，不会启动或切换 Agent。\n\n当前项目：${esc(project().name)}\n当前路径：${esc(project().path)}\n\n<span class="muted">没有连接真实终端或服务。</span>` : output;
    return `<section class="terminal-pane" aria-label="${isShell?'Shell':esc(session.name)} 演示终端"><div class="terminal-title">${icon('terminal')}<strong>${second?'Shell · 分屏':esc(session.name)}</strong>${badge(isShell?'空闲':esc(session.status),!isShell&&session.status==='等待确认'?'amber':'')}</div><pre class="terminal-output">${actualOutput}</pre><form class="terminal-input" data-form="terminal"><span class="cursor">›</span><input aria-label="演示终端输入" placeholder="输入仅展示，不执行命令" autocomplete="off"><button class="icon-button" type="submit" aria-label="提交演示输入">${icon('arrow')}</button></form></section>`;
  }
  function workspaceView() {
    const current = state.sessions.find((s,i)=>i===state.session && s.project===state.project) || state.sessions.find(s=>s.project===state.project);
    const waiting = state.collabs.filter(c=>c.status==='waiting');
    return `<section class="workbench"><header class="workspace-head"><div><h1>工作台</h1><p>${esc(project().path)} <span class="muted"> / 演示会话</span></p></div><div class="page-actions">${btn(`${icon('plus')}新建会话`,'new-session')}${btn(icon('split'),'split','subtle',`aria-label="切换单 / 双终端" aria-pressed="${state.split}"`)}${btn(`${icon('collab')}${waiting.length} 待确认`,'queue','subtle',`aria-expanded="${state.queue}"`)}</div></header>
      <div class="workspace-body ${state.queue?'':'no-queue'}"><div class="terminal-grid ${state.split&&current?'':'single'}">${current?terminalPane(current):empty('这个项目还没有会话','创建一个演示会话开始，原型不会启动终端。',btn('新建会话','new-session','primary'))}${state.split&&current?terminalPane(current,true):''}</div>
      ${state.queue?`<aside class="queue" aria-label="待确认队列"><div class="queue-head"><h2>待你确认 ${badge(waiting.length,'amber')}</h2><button class="icon-button" data-action="queue" aria-label="关闭待确认队列">${icon('close')}</button></div>
      ${waiting.length?waiting.map((c)=>`<article class="queue-item">${badge('结果已就绪','amber')}<h3>${c.title}</h3><p>${c.summary}</p><div class="queue-meta"><span class="small muted">${c.agent} · 演示结果</span></div><div class="page-actions">${btn('查看结果','collab-detail','small',`data-index="${state.collabs.indexOf(c)}"`)}</div></article>`).join(''):empty('队列已清空','所有演示结果都已处理。')}
      <div class="queue-context"><h3>项目上下文</h3><dl class="context-facts"><dt>项目</dt><dd>${esc(project().name)}</dd><dt>分支</dt><dd class="mono">${esc(project().branch)}</dd><dt>文件改动</dt><dd>2 个 · 示例</dd><dt>Provider</dt><dd>配置仅用于新会话</dd></dl><button class="link-button" data-route="files">查看文件与差异 →</button><div class="notice"><small>已选用的 Provider 仅应用于新建演示会话。不会切换正在运行的 Agent。</small></div></div></aside>`:''}</div></section>`;
  }
  function projectsView() {
    const rows = state.projects.filter(p=>`${p.name} ${p.path}`.toLowerCase().includes(state.search.projects.toLowerCase()));
    return `<section class="page">${pageHeader('项目与工作区','把项目留在一个清晰的上下文里，随时回到自己的工作轨道。',btn(`${icon('plus')}新建项目`,'new-project','primary'),'PROJECTS / LOCAL FIRST')}
      <div class="filterbar">${searchField('projects','搜索项目名称或路径')}<select aria-label="工作区" data-change="workspace">${options(state.workspaces.map(w=>[w,w]),state.workspace)}</select>${btn('新建工作区','new-workspace','subtle')}</div>
      <div class="section-heading"><h2>${esc(state.workspace)}</h2><small>${rows.length} 个示例项目</small></div><div class="list" id="project-list">${projectRows(rows)}</div>
      <div class="notice">路径是合成示例。添加项目不会读取文件夹，远程项目也不会自动连接。</div></section>`;
  }
  function projectRows(rows) {return rows.map(p=>`<article class="list-row"><div class="file-symbol">${icon(p.kind.includes('SSH')?'ssh':'projects')}</div><div class="row-info"><h3>${esc(p.name)} ${state.projects.indexOf(p)===state.project?badge('当前项目'):''}</h3><p><code>${esc(p.path)}</code></p></div><span class="badge">${p.kind}</span><div class="row-actions">${btn('进入工作台','open-project','',`data-index="${state.projects.indexOf(p)}"`)}</div></article>`).join('')||empty('没有匹配的项目','试试项目名称，或清空搜索。',btn('清空搜索','clear-projects'));}
  function sshView() {
    return `<section class="page">${pageHeader('SSH 连接','远程环境，同一工作台。连接过程仅为本地模拟。',btn(`${icon('plus')}添加主机`,'ssh-new','primary'),'REMOTE / SYNTHETIC')}
      <div class="list">${state.sshHosts.map((h,i)=>`<article class="list-row"><div class="file-symbol">${icon('ssh')}</div><div class="row-info"><h3>${esc(h.name)} ${badge(h.status==='success'?'模拟已连接':h.status==='loading'?'模拟连接中':h.status==='error'?'模拟失败':h.fail?'错误示例':'未连接',h.status==='success'?'green':h.fail?'error':'')}</h3><p><code>${esc(h.user)}@${esc(h.host)}:${h.port}</code> · ${esc(h.path)}</p><small class="muted">${{key:'私钥路径',password:'密码',agent:'SSH Agent'}[h.auth]}认证 · 演示</small></div><div class="row-actions">${btn('编辑认证','ssh-form','',`data-index="${i}"`)}${btn(h.status==='loading'?'连接中…':h.fail?'模拟连接失败':'模拟连接','ssh-connect',h.fail?'':'primary',`data-index="${i}" ${h.status==='loading'?'disabled':''}`)}</div></article>`).join('')}</div>
      ${btn('查看错误场景','ssh-error','subtle')}
      ${state.sshStatus==='error'?`<div class="notice warn" role="alert"><strong>模拟连接失败：主机不可达。</strong><p>没有发送网络请求。请检查演示主机设置，或重新运行成功场景。</p>${btn('重试成功场景','ssh-connect','small')}</div>`:state.sshStatus==='success'?'<div class="notice success">连接模拟完成。未建立 SSH 通道，未启动远程终端。</div>':'<div class="notice">请勿输入真实密码或私钥。认证表单只展示本地 UI 流程；所有主机均使用 example.invalid。</div>'}</section>`;
  }
  function collabView() {
    const statuses = [['waiting','等你确认'],['running','进行中'],['done','已结束']];
    const rows=state.collabs.filter(c=>c.status===state.collabFilter);
    return `<section class="page">${pageHeader('会话协作','先读结果，再决定下一步。所有协作内容都是演示样例。','','COLLABORATION / REVIEW')}
      <div class="tabs" aria-label="协作状态">${statuses.map(([v,l])=>`<button class="tab ${state.collabFilter===v?'active':''}" data-action="collab-filter" data-value="${v}" aria-pressed="${state.collabFilter===v}">${l} <span class="muted">${state.collabs.filter(c=>c.status===v).length}</span></button>`).join('')}</div>
      <div class="list">${rows.map(c=>`<article class="list-row"><div class="file-symbol">${icon('collab')}</div><div class="row-info"><h3>${c.title}</h3><p>${c.summary}</p><small class="muted">${c.agent} · ${esc(project().name)} · 演示</small></div><div class="row-actions">${btn('查看结果','collab-detail','',`data-index="${state.collabs.indexOf(c)}"`)}${c.status==='running'?btn('模拟结果就绪','collab-ready','',`data-index="${state.collabs.indexOf(c)}"`):''}</div></article>`).join('')||empty('这里暂时没有协作','切换筛选查看其他演示任务。')}</div></section>`;
  }
  const fileContent = {
    'Workbench.tsx':[['','import { Sidebar } from "./Sidebar";'],['',''],['','export function Workbench() {'],['remove','-  const [collapsed, setCollapsed] = useState(true);'],['add','+  const [collapsed, setCollapsed] = useState(false);'],['','  return ('],['','    <main aria-label="工作台">'],['add','+      <Sidebar aria-label="项目与会话" />'],['','    </main>'],['','  );'],['','}']],
    'styles.css':[['','/* Workbench navigation */'],['remove','- --nav-width: 200px;'],['add','+ --nav-width: 220px;'],['add','+ --focus-ring: var(--accent);'],['',''],['','button:focus-visible {'],['add','+ outline: 2px solid var(--focus-ring);'],['','}']],
    'README.md':[['','# Belfry'],['',''],['','本地优先的多项目、多终端工作台。'],['',''],['','## 工作环境'],['','项目、会话和工具共用同一上下文。'],['',''],['','此文件是设计原型中的固定演示内容。']]
  };
  function filesView() {
    return `<section class="page">${pageHeader('文件与 Git','belfry / ui/refinement · 2 个演示改动',btn(state.preview?'关闭预览':'打开预览','file-preview'),'FILES / WORKING TREE')}
      <div class="tabs"><button class="tab ${state.fileMode==='diff'?'active':''}" data-action="file-mode" data-value="diff" aria-pressed="${state.fileMode==='diff'}">工作区差异</button><button class="tab ${state.fileMode==='source'?'active':''}" data-action="file-mode" data-value="source" aria-pressed="${state.fileMode==='source'}">文件内容</button></div>
      <div class="file-layout"><nav class="file-tree" aria-label="示例文件树"><div class="group-label">belfry / src</div>${Object.keys(fileContent).map(f=>`<button class="tree-item ${state.file===f?'active':''}" data-action="file-select" data-value="${f}" aria-pressed="${state.file===f}">${icon('files')}${f}<small>${f==='README.md'?'':'M'}</small></button>`).join('')}</nav>
      <section><div class="editor-head"><code>${state.file}</code><span class="small muted">只读 · 演示文件</span></div>${state.preview?`<article class="preview-pane"><h2>${state.file==='README.md'?'Belfry':'变更预览'}</h2><p>${state.file==='README.md'?'本地优先的多项目、多终端工作台。项目、会话和工具共用同一上下文。':'导航默认展开，并添加清晰的键盘焦点样式。此处是演示摘要，不编译或运行代码。'}</p><div class="notice">只读预览，不访问真实项目。</div></article>`:`<pre class="code-view">${fileContent[state.file].filter(([type])=>state.fileMode==='diff'||type!=='remove').map(([type,text],i)=>`<span class="code-line ${state.fileMode==='diff'?type:''}"><span class="line-number">${String(i+1).padStart(2,'0')}</span>${esc(state.fileMode==='source'?text.replace(/^\+  /,'  '):text)}</span>`).join('')}</pre>`}</section></div></section>`;
  }
  function historyRows() {
    const rows=state.historyEmpty?[]:state.history.filter(h=>`${h.name} ${h.project} ${h.agent}`.toLowerCase().includes(state.search.history.toLowerCase())&&(state.historyProject==='all'||h.project===state.historyProject)&&(state.historySource==='all'||h.agent===state.historySource));
    return rows.map(h=>`<article class="list-row"><div class="file-symbol">${icon('history')}</div><div class="row-info"><h3>${h.name}</h3><p>${h.project} / ${h.agent} · ${h.detail}</p></div><span class="small muted">${h.time}</span>${btn('恢复会话','history-restore','',`data-index="${state.history.indexOf(h)}"`)}</article>`).join('')||empty('没有找到会话','没有结果不等于记录丢失。清空搜索或更换筛选。',btn('重置筛选','history-reset'));
  }
  function historyView() {return `<section class="page">${pageHeader('会话历史','已结束的思路，仍然可以接着走。恢复会创建一个新的演示会话。',btn(state.historyEmpty?'显示示例记录':'查看空状态','history-empty','subtle'),'HISTORY / LOCAL INDEX')}
    <div class="filterbar">${searchField('history','搜索会话、项目或 Agent')}<select aria-label="历史项目" data-change="history-project">${options([['all','全部项目'],['belfry','belfry'],['docs-site','docs-site']],state.historyProject)}</select><select aria-label="历史来源" data-change="history-source">${options([['all','全部来源'],['Claude Code','Claude Code'],['Codex','Codex'],['Shell','Shell']],state.historySource)}</select></div><div id="history-list" class="list">${historyRows()}</div></section>`;}
  function usageView() {
    const ratio=(state.usageRange==='1'?.22:state.usageRange==='30'?3.4:1)*(state.usageScope==='project'?.65:1);
    return `<section class="page">${pageHeader('用量','了解本地会话的消耗，而不是把估算当作账单。','','USAGE / DEMO DATA')}
      <div class="filterbar"><select aria-label="用量时间范围" data-change="usage-range">${options([['1','今天'],['7','最近 7 天'],['30','最近 30 天']],state.usageRange)}</select><select aria-label="用量作用域" data-change="usage-scope">${options([['all','全部项目'],['project',`当前项目 · ${project().name}`]],state.usageScope)}</select>${badge('演示数据')}</div>
      <div class="usage-summary"><div><small>输入 Tokens</small><strong>${Math.round(186400*ratio).toLocaleString()}</strong></div><div><small>输出 Tokens</small><strong>${Math.round(32800*ratio).toLocaleString()}</strong></div><div><small>估算成本 / USD</small><strong>$${(2.14*ratio).toFixed(2)}</strong></div></div>
      <div class="section-heading"><h2>按 Agent 查看</h2><small>固定合成样例，未读取本地日志</small></div><div class="table-wrap"><table><thead><tr><th>Agent</th><th>演示会话</th><th>输入 / 输出</th><th>估算成本</th></tr></thead><tbody>${[['Claude Code',8,142000,26400,1.72],['Codex',3,44400,6400,.42]].map(([a,n,i,o,c])=>`<tr><td>${a}</td><td>${Math.max(1,Math.round(n*ratio))}</td><td class="mono">${Math.round(i*ratio).toLocaleString()} / ${Math.round(o*ratio).toLocaleString()}</td><td class="mono">$${(c*ratio).toFixed(2)}</td></tr>`).join('')}</tbody></table></div>
      <div class="scope-note"><span>来源：原型内置示例数据</span><span>计价：演示估算，不含缓存、税费或套餐差异</span></div><div class="notice">不连接服务商账单，也不代表实际消耗。时间范围与作用域只切换示例数据。</div></section>`;
  }
  function pluginRows() {
    const rows=state.plugins.filter(p=>(state.pluginTab==='market'||p.installed)&&`${p.name} ${p.description}`.toLowerCase().includes(state.search.plugins.toLowerCase()));
    return rows.map(p=>`<article class="list-row"><div class="file-symbol">${icon('plugins')}</div><div class="row-info"><h3>${p.name} <span class="small muted">${p.version}</span></h3><p>${p.description}</p><small class="muted">${p.source}</small></div><div class="row-actions">${p.installed?badge(p.enabled?'已启用 · 模拟':'已禁用',p.enabled?'green':''):badge('未安装')}${btn('详情','plugin-detail','',`data-id="${p.id}"`)}${p.installed?btn(p.enabled?'禁用':'启用','plugin-toggle','',`data-id="${p.id}" aria-pressed="${p.enabled}"`):btn('模拟安装','plugin-install','',`data-id="${p.id}"`)}</div></article>`).join('')||empty('没有匹配的插件','更换关键词，或查看市场演示。');
  }
  function pluginsView(inSettings=false) {return `<section class="${inSettings?'':'page'}">${pageHeader('插件中心','扩展工作台，不模糊权限边界。此原型不下载或运行插件。','','EXTENSIONS / HOST UI')}
    <div class="tabs"><button class="tab ${state.pluginTab==='installed'?'active':''}" data-action="plugin-tab" data-value="installed" aria-pressed="${state.pluginTab==='installed'}">已安装 ${state.plugins.filter(p=>p.installed).length}</button><button class="tab ${state.pluginTab==='market'?'active':''}" data-action="plugin-tab" data-value="market" aria-pressed="${state.pluginTab==='market'}">市场 · 演示</button></div><div class="filterbar">${searchField('plugins','搜索插件名称或描述')}</div><div id="plugin-list" class="list">${pluginRows()}</div><div class="notice">插件详情展示来源与权限。普通 worker 不等于安全沙箱；第三方插件页面不在此次换肤范围内。</div></section>`;}
  function providerView(isProject=false) {
    const rows=activeProviders(); const override=!!state.projectOverrides[project().name];
    return `${pageHeader(isProject?'项目 Provider':'全局 Provider',isProject?`作用域：${esc(project().name)}。项目覆盖优先于全局，仅用于新会话。`:'按 Agent 配置连接。已配置不等于已验证，选用不会切换运行中的 Agent。',btn(`${icon('plus')}添加服务`,'provider-new','',isProject&&!override?'disabled':''),'AGENT / CONNECTION')}
      ${isProject?settingRow('项目覆盖',override?'本项目使用独立的演示配置。':'当前继承全局配置。启用覆盖后可独立编辑。',`<label class="check-row"><input type="checkbox" data-change="project-override" ${override?'checked':''}>启用演示覆盖</label>`):''}
      <div class="tabs" aria-label="Agent 类型">${['Claude Code','Codex','Pi'].map(a=>`<button class="tab ${state.agent===a?'active':''}" data-action="provider-agent" data-value="${a}" aria-pressed="${state.agent===a}">${a}</button>`).join('')}</div>
      <div class="list">${rows.map(p=>`<article class="list-row provider-row"><div class="row-info"><h3>${esc(p.name)} ${badge(p.configured?'已配置':'未配置')} ${p.selected?badge('已选用','green'):''}</h3><p>${esc(p.endpoint)}</p><small class="muted">${state.agent} · ${isProject?'项目':'全局'} · 连接未验证</small></div><div class="row-actions">${btn('编辑','provider-edit','',`data-id="${p.id}" data-testid="provider-edit" ${isProject&&!override?'disabled':''}`)}${btn('选用于新会话','provider-select','',`data-id="${p.id}" ${p.selected||!p.configured||(isProject&&!override)?'disabled':''}`)}</div></article>`).join('')}</div>
      <div class="notice">凭据只显示配置状态。编辑时可以保留、替换或清除；端点变更不能保留旧凭据。所有表单均使用演示文本，不要输入真实 Key。</div>
      <div class="setting-row"><div><h3>敏感原始配置</h3><p>显式确认后显示合成占位内容。关闭或离开即清空。</p></div>${btn(`${icon('eye')}查看原始配置`,'raw-open','',`data-testid="reveal-secrets"`)}</div>`;
  }
  function settingsView(key) {
    const menu=`<nav class="settings-nav" aria-label="设置分类"><h2>设置</h2>${settings.map(([k,l,g,group])=>`${group?`<div class="group-label">${group}</div>`:''}${routeBtn(`settings/${k}`,l,g)}`).join('')}</nav>`;
    const pages={
      appearance:()=>`${pageHeader('外观','让外壳安静下来，把注意力留给正在做的事。','','PREFERENCES / APPEARANCE')}<h2>界面方案</h2><div class="theme-choices">${[['graphite','Graphite','石墨轨道 · 主方案','dark'],['paper','Paper','平面纸白 · 编辑式','light'],['compact','Compact','高密度 · 紧凑导航','dark compact']].map(([v,l,d,s])=>`<button class="theme-choice ${state.variant===v?'selected':''}" data-action="choose-variant" data-value="${v}" aria-pressed="${state.variant===v}"><span class="theme-sample ${s}"><i></i><i></i></span><strong>${l}</strong><small>${d}</small></button>`).join('')}</div>${settingRow('主题','深色石墨与暖白均保持清晰的文本对比。',btn(state.theme==='dark'?'切换暖白':'切换石墨','theme'))}${settingRow('终端字体','沿用本地 JetBrains Mono；不加载外部字体。','<span class="mono">JetBrains Mono / 14px</span>')}${settingRow('减少动态效果','尊重系统 prefers-reduced-motion 设置。','<span class="badge">跟随系统</span>')}<div class="notice">原型不使用装饰背景或壁纸。主题与密度设置仅保留在本次页面内存中。</div>`,
      provider:()=>providerView(), 'project-provider':()=>providerView(true), plugins:()=>pluginsView(true),
      'agent-hooks':()=>`${pageHeader('会话状态','用明确状态区分进行中、等待确认与已结束。','','AGENT / STATUS')}${settingRow('Agent 状态 Hooks','模拟接收状态事件，不注入真实 CLI。',`<label class="check-row"><input type="checkbox" data-change="hooks" ${state.hooks?'checked':''}>启用演示</label>`)}<div class="section-heading"><h2>状态映射</h2></div><div class="list">${[['进行中','工具调用与输出中'],['等待确认','需要你决定下一步'],['已结束','当前任务完成，不代表终端关闭']].map(([a,b])=>`<div class="list-row"><div class="row-info"><h3>${a}</h3><p>${b}</p></div>${badge(state.hooks?'映射已启用':'映射已关闭')}</div>`).join('')}</div><div class="notice">这些状态是合成样例；不声明已经监听或切换真实 Agent。</div>`,
      'background-sessions':()=>`${pageHeader('后台会话','退出当前视图与结束终端是不同的动作。原型仅展示生命周期。','','SESSIONS / BACKGROUND')}${settingRow('后台保留','演示设置，不影响系统进程。',`<label class="check-row"><input type="checkbox" data-change="background" ${state.background?'checked':''}>保留演示会话</label>`)}<div class="list">${state.sessions.length?state.sessions.map((s,i)=>`<div class="list-row"><div class="row-info"><h3>${esc(s.name)}</h3><p>${s.agent} · ${s.status}</p></div>${btn('返回会话','select-session','',`data-index="${i}"`)}${btn('结束演示','end-session','danger',`data-index="${i}"`)}</div>`).join(''):empty('没有后台会话','可以从工作台创建新的演示会话。',btn('新建会话','new-session'))}</div>`,
      shortcuts:()=>`${pageHeader('快捷键','高频操作不离开键盘。以下组合键可在原型中实际使用。','','PREFERENCES / KEYBOARD')}<div class="list">${[['Quick Open','⌘ / Ctrl K'],['切换侧栏','⌘ / Ctrl B'],['关闭弹窗','Escape'],['选择快速打开结果','↑ ↓ / Enter'],['切换控件焦点','Tab / Shift Tab']].map(([a,b])=>`<div class="list-row"><div class="row-info"><h3>${a}</h3></div><kbd>${b}</kbd></div>`).join('')}</div>${settingRow('自定义键位','原型不写入系统快捷键。可查看演示冲突提示。',btn('编辑演示键位','shortcut-edit'))}`,
      backup:()=>`${pageHeader('本地备份','只备份工作环境，不把凭据带入配置副本。',btn('创建演示备份','backup-new','primary'),'DATA / LOCAL BACKUP')}<div class="notice">演示备份仅存于当前页面内存。不读写磁盘，不包含 Key、会话正文或用户文件。</div><div class="list">${state.backups.map((b,i)=>`<div class="list-row"><div class="row-info"><h3>${b.name}</h3><p>${b.detail}</p><small class="muted">${b.time}</small></div>${btn('恢复演示','backup-restore','',`data-index="${i}"`)}${btn('删除','backup-delete','danger',`data-index="${i}"`)}</div>`).join('')||empty('还没有备份','创建一个不含凭据的示例备份。')}</div>`,
      environment:()=>`${pageHeader('协作环境','检查本地工作环境的入口，不隐式修复系统。','','HELP / DIAGNOSTICS')}<div class="list">${[['Git','版本控制工具 · 示例状态','可用'],['Node.js','插件宿主所需运行时 · 示例状态','可用'],['Agent CLI','原型不检测本机安装状态','未检测'],['SSH','原型不检测网络或凭据','未检测']].map(([a,b,c])=>`<div class="list-row"><div class="row-info"><h3>${a}</h3><p>${b}</p></div>${badge(c)}</div>`).join('')}</div><div class="notice">检测结果为演示，不表示你电脑的实际状态。操作不会安装或执行任何程序。</div>${btn('运行模拟检测','environment-check')}`,
      about:()=>`${pageHeader('关于 Belfry','本地优先的多项目、多终端与 CLI Agent 桌面工作台。','','BELFRY / ABOUT')}<div class="brand" style="padding:0"><img src="assets/belfry.png" alt="Belfry 图标"><strong>Belfry</strong>${badge('UI 设计原型')}</div>${settingRow('此版本的边界','独立 HTML 原型。不是已落地的 React / Tauri 产品。','<span class="mono">UI study 01</span>')}${settingRow('本地资产','现有应用图标、HarmonyOS Sans SC 与 JetBrains Mono。',badge('无外部资源'))}${settingRow('项目与隐私','不连接真实服务、不访问用户项目、不持久化凭据。',btn('查看数据边界','privacy'))}<div class="notice">生产界面应在确认本原型后分批接入。版本升级与真实 PTY 生命周期不由此原型模拟替代。</div>`,
      update:()=>`${pageHeader('更新','明确知道检查了什么，再决定是否升级。','','HELP / UPDATE')}${settingRow('原型更新检查','不请求更新服务器，不下载安装包。',btn(state.updateStatus==='loading'?'模拟检查中…':'模拟检查更新','update-check','',state.updateStatus==='loading'?'disabled':''))}<div id="update-result" class="notice">${state.updateStatus==='done'?'模拟检查完成：当前为 UI study 01，无可安装更新。':state.updateStatus==='error'?'模拟错误：更新源不可达。你可以重试，不影响当前工作。':'尚未检查。点击按钮体验 loading 与结果状态。'}</div>${btn('查看失败场景','update-error','subtle')}`
    };
    return `<section class="settings-layout">${menu}<div class="settings-content">${(pages[key]||pages.appearance)()}</div></section>`;
  }
  const views={workspace:workspaceView,projects:projectsView,ssh:sshView,collab:collabView,files:filesView,history:historyView,usage:usageView,plugins:pluginsView};
  function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4200);}
  function openModal(kind,title,body,footer='',focusSelector='') {
    if(modal.open) closeModal(true);
    returnFocus=document.activeElement;modalKind=kind;
    modal.innerHTML=`<header class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="modal-close" data-testid="modal-close" aria-label="关闭弹窗">${icon('close')}</button></header>${body}${footer?`<footer class="modal-footer">${footer}</footer>`:''}`;
    modal.showModal();(focusSelector?$(focusSelector,modal):$('input,button',modal))?.focus();
  }
  function closeModal(force=false) {
    if(!force && editor?.dirty){leave(()=>closeModal(true));return;}
    // Actively wipe input values and raw preview before removing their DOM nodes.
    $$('input[type=password],textarea',modal).forEach(i=>i.value='');
    modal.close();modal.innerHTML='';modalKind='';editor=null;
    if(returnFocus?.isConnected) returnFocus.focus(); else $('[data-testid=quick-open]')?.focus();
  }
  function leave(callback) {
    if(editor?.dirty){
      pendingLeave=callback;
      confirmation.innerHTML=`<header class="modal-head"><h2 id="confirm-title">放弃未保存的更改？</h2></header><div class="modal-body"><p>凭据输入与表单修改尚未保存。离开后会清空这些演示输入。</p></div><footer class="modal-footer">${btn('继续编辑','continue-edit')}${btn('放弃更改','discard-changes','danger','data-testid="discard-changes"')}</footer>`;
      if(!confirmation.open) confirmation.showModal();$('[data-action=continue-edit]',confirmation).focus();
    }else callback();
  }
  function confirmAction(title,desc,callback) {
    pendingLeave=callback;
    confirmation.innerHTML=`<header class="modal-head"><h2 id="confirm-title">${title}</h2></header><div class="modal-body"><p>${desc}</p></div><footer class="modal-footer">${btn('取消','continue-edit')}${btn('确认演示操作','confirm-action','danger')}</footer>`;
    confirmation.showModal();$('[data-action=continue-edit]',confirmation).focus();
  }
  function editProvider(id) {
    const p=activeProviders().find(p=>p.id===id);const isNew=!p;
    openModal('provider',isNew?'添加 Provider':'编辑 Provider',`<form id="provider-form" data-form="provider" data-testid="provider-form"><div class="modal-body"><div class="notice">${state.agent} · ${state.route.includes('project-provider')?'项目':'全局'}配置。请只使用合成演示文本，凭据不会持久化。</div>
      <div class="field"><label for="provider-name">服务名称</label><input id="provider-name" name="name" value="${esc(p?.name||'')}" placeholder="例如：团队网关 · 演示" required></div>
      <div class="field"><label for="provider-endpoint">API 端点</label><input id="provider-endpoint" name="endpoint" data-testid="provider-endpoint" value="${esc(p?.endpoint||'https://new.example.invalid/v1')}" required><small>只允许 https://*.example.invalid 演示地址。更换端点后必须替换或清除凭据。</small></div>
      <h3 id="key-action-label">凭据动作</h3><div class="key-actions" role="group" aria-labelledby="key-action-label">${[['keep','保留现有'],['replace','替换'],['clear','清除']].map(([v,l])=>`<label><input type="radio" name="keyAction" value="${v}" data-testid="key-action" ${(isNew?v==='replace':v==='keep')?'checked':''} ${isNew&&v==='keep'?'disabled':''}>${l}</label>`).join('')}</div>
      <div class="field" id="key-field" ${isNew?'':'hidden'}><label for="provider-key">新凭据 · 仅演示</label><input id="provider-key" type="password" data-testid="provider-key" autocomplete="off" placeholder="请输入合成占位文本" ${isNew?'':'disabled'}><small>替换必须有非空文本。此输入仅活在弹窗 DOM 中，保存后立即清空。</small></div><p id="provider-error" class="form-error" role="alert"></p></div>
      <footer class="modal-footer">${btn('取消','modal-close')}${btn('保存演示配置','provider-save','primary','data-testid="provider-save"')}</footer></form>`,'','#provider-name');
    editor={id:p?.id||null,endpoint:p?.endpoint||'',dirty:false,isNew};
  }
  function saveProvider() {
    const form=$('#provider-form');const name=$('#provider-name').value.trim();const endpoint=$('#provider-endpoint').value.trim();const action=$('input[name=keyAction]:checked',form).value;const key=$('#provider-key').value;
    let error='';let url;
    try{url=new URL(endpoint);if(url.protocol!=='https:'||!url.hostname.endsWith('.example.invalid')||url.username||url.password)error='请使用 https://*.example.invalid 的演示端点，不要填写真实服务或凭据。';}catch{error='请输入有效的演示端点。';}
    if(!name)error='请输入服务名称。';
    else if(action==='keep'&&editor.isNew)error='新建服务不能保留不存在的凭据。';
    else if(action==='keep'&&endpoint!==editor.endpoint)error='端点已更改，不能保留旧凭据。请选择「替换」或「清除」。';
    else if(action==='replace'&&!key.trim())error='替换凭据需要非空的演示文本。';
    if(error){$('#provider-error').textContent=error;return;}
    if(editor.id){const p=activeProviders().find(p=>p.id===editor.id);p.name=name;p.endpoint=endpoint;if(action!=='keep')p.configured=action==='replace';if(!p.configured)p.selected=false;}
    else activeProviders().push({id:`demo-${Date.now()}`,name,endpoint,configured:action==='replace',selected:false});
    $('#provider-key').value='';editor.dirty=false;closeModal(true);render();toast('演示配置已保存 · 连接未验证 · 不影响运行中的 Agent');
  }
  function rawOpen() {
    openModal('raw','敏感原始配置',`<div class="modal-body"><div class="notice warn">只展示合成配置。关闭此弹窗或切换页面后，内容立即清空。</div><label class="check-row"><input type="checkbox" data-change="raw-optin">我了解风险，显示演示原始配置</label><div id="raw-area" style="margin-top:20px"><p class="muted">原始配置已隐藏。</p></div></div>`,btn('关闭并清空','modal-close'));
  }
  function quickOpen() {
    leave(()=>{
      openModal('quick','快速打开',`<div class="quick-search"><label class="search-field">${icon('search')}<input id="quick-query" role="combobox" aria-controls="quick-results" aria-expanded="true" aria-autocomplete="list" aria-label="搜索页面、设置或会话" placeholder="搜索页面、设置或会话…" autocomplete="off"></label></div><div id="quick-results" class="quick-results" role="listbox" aria-label="搜索结果"></div><div class="quick-footer"><kbd>↑ ↓</kbd> 选择 &nbsp; <kbd>Enter</kbd> 打开 &nbsp; <kbd>Esc</kbd> 返回</div>`,'','#quick-query');quickIndex=0;filterQuick('');
    });
  }
  function filterQuick(query) {
    const all=[...nav.map(([route,label])=>({route,label,type:'页面',glyph:route})),...settings.map(([key,label,glyph])=>({route:`settings/${key}`,label,type:'设置',glyph})),...state.sessions.map((s,i)=>({label:s.name,type:`会话 / ${s.agent}`,session:i,glyph:'terminal'}))];
    quickItems=all.filter(i=>`${i.label} ${i.route||''} ${i.type}`.toLowerCase().includes(query.toLowerCase()));quickIndex=Math.min(quickIndex,Math.max(0,quickItems.length-1));
    $('#quick-results').innerHTML=quickItems.length?quickItems.map((item,i)=>`<button class="quick-item ${quickIndex===i?'selected':''}" role="option" aria-selected="${quickIndex===i}" data-action="quick-select" data-index="${i}" id="quick-item-${i}" tabindex="-1">${icon(item.glyph)}<span>${esc(item.label)}</span><small>${esc(item.type)}</small></button>`).join(''):empty('没有匹配的结果','换一个关键词，比如「Provider」或「历史」。');
    $('#quick-query').setAttribute('aria-activedescendant',quickItems.length?`quick-item-${quickIndex}`:'');
  }
  function selectQuick(index) {const item=quickItems[index];if(!item)return;closeModal(true);if(item.session!==undefined)selectSession(item.session);else navigate(item.route);}
  function selectSession(index) {const session=state.sessions[index];if(!session)return;state.session=index;state.project=session.project;navigate('workspace');}
  function newForm(kind,title,fields,submitLabel='创建演示') {
    openModal(kind,title,`<form data-form="${kind}"><div class="modal-body"><p class="muted" style="margin-bottom:20px">仅创建当前页面内存中的示例，不访问本机文件。</p>${fields}<p class="form-error" role="alert"></p></div><footer class="modal-footer">${btn('取消','modal-close')}<button class="button primary" type="submit">${submitLabel}</button></footer></form>`,'','input');
  }
  const textField=(id,label,value='',placeholder='')=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" value="${esc(value)}" placeholder="${placeholder}" required autocomplete="off"></div>`;
  function sshForm(index=-1) {
    const h=state.sshHosts[index] || {name:'新主机 · 演示',host:'new.example.invalid',port:'22',user:'demo',path:'/srv/demo',auth:'key'};
    openModal('ssh','主机与认证 · 演示',`<form data-form="ssh" data-host-index="${index}"><div class="modal-body"><div class="notice">只填演示值。密码不保存，私钥路径不会被读取。</div>${textField('ssh-name','主机名称',h.name)}<div class="form-grid">${textField('ssh-host','主机',h.host)}${textField('ssh-port','端口',h.port)}${textField('ssh-user','用户',h.user)}${textField('ssh-path','项目路径',h.path)}</div><div class="field"><label for="ssh-auth">认证方式</label><select id="ssh-auth" class="field-select" data-change="ssh-auth">${options([['key','私钥路径 · 演示'],['password','密码 · 演示'],['agent','SSH Agent · 演示']],h.auth)}</select></div><div id="ssh-auth-field">${h.auth==='agent'?'<div class="notice">不调用系统 SSH Agent。</div>':h.auth==='password'?'<div class="field"><label for="ssh-credential">演示密码（请勿输入真实密码）</label><input id="ssh-credential" type="password" autocomplete="off" placeholder="仅合成示例文本"></div>':textField('ssh-credential','演示私钥路径','~/.ssh/demo_key')}</div><p class="form-error" role="alert"></p></div><footer class="modal-footer">${btn('取消','modal-close')}<button class="button primary" type="submit">保存演示主机</button></footer></form>`,'','#ssh-host');
  }
  function simulateSSH(fail=false,index=0) {
    const host=state.sshHosts[index];if(!host||host.status==='loading')return;
    state.sshStatus=host.status='loading';render();setTimeout(()=>{state.sshStatus=host.status=fail?'error':'success';if(state.route==='ssh')render();toast(fail?'模拟连接失败 · 未发送网络请求':'模拟连接成功 · 未建立 SSH 通道');},800);
  }
  function collabDetail(index) {
    const c=state.collabs[index];openModal('collab','协作结果',`<div class="modal-body"><p>${c.title} / ${c.agent} · 演示</p><h3>结果摘要</h3><p style="margin:12px 0 20px">${c.summary}</p><div class="notice">建议：保留项目 / 会话 / 工具三段导航，使用显式焦点环，并在未保存时阻止离开。</div><p class="muted">接受仅更新演示任务状态，不修改真实文件；退回仅展示需要重新处理的状态。</p></div>`,c.status==='waiting'?`${btn('退回演示结果','collab-reject','',`data-index="${index}"`)}${btn('接受演示结果','collab-accept','primary',`data-index="${index}"`)}`:btn('关闭','modal-close'));
  }
  function pluginDetail(id) {
    const p=state.plugins.find(p=>p.id===id);openModal('plugin',p.name,`<div class="modal-body"><p>${p.description}</p><div class="list"><div class="list-row"><div class="row-info"><h3>版本与来源</h3><p>${p.version} / ${p.source}</p></div></div><div class="list-row"><div class="row-info"><h3>声明权限</h3><p>${p.permissions}</p></div></div></div><div class="notice warn">权限声明不是安全证明。普通 worker 不等于隔离沙箱。原型不会运行、安装或下载插件。</div></div>`,btn('关闭详情','modal-close'));
  }
  const actions={
    'theme':()=>{state.theme=state.theme==='dark'?'light':'dark';render();toast(`已切换${state.theme==='dark'?'石墨深色':'暖白'}主题`);},
    'choose-variant':el=>{state.variant=el.dataset.value;if(state.variant==='paper')state.theme='light';render();},
    'sidebar':()=>{if(innerWidth<=760)$('#app').classList.toggle('mobile-sidebar');else{state.sidebar=!state.sidebar;renderShell();}},
    'queue':()=>{state.queue=!state.queue;render();}, 'split':()=>{state.split=!state.split;render();},
    'quick-open':quickOpen, 'quick-select':el=>selectQuick(+el.dataset.index), 'select-session':el=>selectSession(+el.dataset.index),
    'new-session':()=>newForm('new-session','新建演示会话',`${textField('session-name','会话名称','','例如：接口检查')}<div class="field"><label for="session-agent">会话类型</label><select id="session-agent" class="field-select"><option>Claude Code</option><option>Codex</option><option>Pi</option><option>Shell</option></select><small>不会启动 CLI 或终端进程。</small></div>`),
    'new-project':()=>newForm('new-project','新建演示项目',textField('project-name','项目名称','','demo-project')+textField('project-path','示例路径','~/Projects/demo-project')),
    'new-workspace':()=>newForm('new-workspace','新建演示工作区',textField('workspace-name','工作区名称','','例如：周末实验')),
    'open-project':el=>{state.project=+el.dataset.index;state.session=Math.max(0,state.sessions.findIndex(s=>s.project===state.project));navigate('workspace');},
    'clear-projects':()=>{state.search.projects='';render();}, 'ssh-new':()=>sshForm(), 'ssh-form':el=>sshForm(+(el.dataset.index||0)), 'ssh-connect':el=>{const i=+(el.dataset.index||0);simulateSSH(state.sshHosts[i].fail,i);}, 'ssh-error':()=>simulateSSH(true,1),
    'collab-filter':el=>{state.collabFilter=el.dataset.value;render();},'collab-detail':el=>collabDetail(+el.dataset.index),
    'collab-accept':el=>{const c=state.collabs[+el.dataset.index];c.status='done';const s=state.sessions.find(s=>s.name===c.title);if(s)s.status='已结束 · 样例';closeModal(true);render();toast('已接受演示结果 · 没有修改文件');},
    'collab-reject':el=>{const c=state.collabs[+el.dataset.index];c.status='running';const s=state.sessions.find(s=>s.name===c.title);if(s)s.status='进行中 · 样例';closeModal(true);render();toast('已退回演示结果 · 状态改为进行中');},
    'collab-ready':el=>{const c=state.collabs[+el.dataset.index];c.status='waiting';const s=state.sessions.find(s=>s.name===c.title);if(s)s.status='等待确认';state.collabFilter='waiting';render();toast('演示结果已就绪 · 不代表真实 Agent 完成');},
    'file-select':el=>{state.file=el.dataset.value;render();},'file-preview':()=>{state.preview=!state.preview;render();},'file-mode':el=>{state.fileMode=el.dataset.value;render();},
    'history-empty':()=>{state.historyEmpty=!state.historyEmpty;render();},'history-reset':()=>{state.historyEmpty=false;state.search.history='';state.historySource=state.historyProject='all';render();},
    'history-restore':el=>{const h=state.history[+el.dataset.index];state.project=Math.max(0,state.projects.findIndex(p=>p.name===h.project));state.sessions.push({name:`${h.name} · 恢复`,agent:h.agent,status:'空闲',project:state.project});state.session=state.sessions.length-1;navigate('workspace');toast('已恢复为新演示会话 · 未启动终端');},
    'plugin-tab':el=>{state.pluginTab=el.dataset.value;render();},'plugin-detail':el=>pluginDetail(el.dataset.id),
    'plugin-toggle':el=>{const p=state.plugins.find(p=>p.id===el.dataset.id);p.enabled=!p.enabled;render();toast(`${p.name} ${p.enabled?'已启用':'已禁用'} · 模拟，不运行插件`);},
    'plugin-install':el=>confirmAction('模拟安装插件？','只更改演示列表，不下载、安装或执行任何代码。',()=>{const p=state.plugins.find(p=>p.id===el.dataset.id);p.installed=true;render();toast('已加入演示安装列表，默认禁用');}),
    'provider-agent':el=>{state.agent=el.dataset.value;render();toast('已切换 Agent 配置视图 · 各 Agent 使用独立的演示配置');},
    'provider-edit':el=>editProvider(el.dataset.id),'provider-new':()=>editProvider(null),'provider-save':saveProvider,
    'provider-select':el=>{activeProviders().forEach(p=>p.selected=p.id===el.dataset.id);render();toast('已选用于新演示会话 · 未验证连接 · 不切换运行中的 Agent');},
    'raw-open':rawOpen,'modal-close':()=>closeModal(),
    'continue-edit':()=>{pendingLeave=null;confirmation.close();if(modal.open)$('input,button',modal)?.focus();},
    'discard-changes':()=>{const cb=pendingLeave;pendingLeave=null;confirmation.close();if(editor)editor.dirty=false;cb?.();},
    'confirm-action':()=>{const cb=pendingLeave;pendingLeave=null;confirmation.close();cb?.();},
    'end-session':el=>confirmAction('结束这个演示会话？','这会从当前内存列表移除会话，不结束系统进程。',()=>{state.sessions.splice(+el.dataset.index,1);state.session=Math.max(0,state.sessions.length-1);render();toast('演示会话已结束');}),
    'backup-new':()=>{state.backups.unshift({name:'新建工作环境 · 演示备份',time:'刚刚',detail:'外观、快捷键、项目索引 · 不含凭据'});render();toast('已创建内存中的演示备份 · 未写磁盘');},
    'backup-restore':()=>confirmAction('恢复演示工作环境？','模拟恢复外观到 Graphite 深色。不恢复项目文件或凭据。',()=>{state.theme='dark';state.variant='graphite';render();toast('已恢复演示外观');}),
    'backup-delete':el=>confirmAction('删除演示备份？','只删除当前页面内存中的示例记录。',()=>{state.backups.splice(+el.dataset.index,1);render();}),
    'environment-check':()=>{toast('正在模拟环境检查…');setTimeout(()=>toast('模拟检查完成 · Git / Node.js 可用样例，未检查本机'),700);},
    'update-check':()=>{state.updateStatus='loading';render();setTimeout(()=>{state.updateStatus='done';if(state.route==='settings/update')render();toast('模拟更新检查完成 · 无下载');},800);},
    'update-error':()=>{state.updateStatus='error';render();},
    'privacy':()=>openModal('privacy','数据与服务边界','<div class="modal-body"><p>所有项目、会话、文件、用量与插件清单均为合成示例。</p><div class="notice">不调用系统 API、不读取用户项目、不发送网络请求、不使用遥测、不存储凭据。刷新将重置全部演示状态。</div></div>',btn('知道了','modal-close')),
    'shortcut-edit':()=>newForm('shortcut','编辑演示键位',textField('shortcut-key','Quick Open 组合键','Ctrl+K')+'<div class="notice">演示冲突检测：Ctrl+B 已用于切换侧栏。不会更改实际快捷键。</div>','检查演示冲突')
  };
  document.addEventListener('click',event=>{
    const el=event.target.closest('button[data-route],button[data-action]');if(!el||el.disabled)return;
    if(el.dataset.route)navigate(el.dataset.route);else actions[el.dataset.action]?.(el);
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(editor&&el.closest('#provider-form'))editor.dirty=true;
    if(el.id==='quick-query'){quickIndex=0;filterQuick(el.value);}
    if(el.dataset.search){state.search[el.dataset.search]=el.value;const lists={projects:['#project-list',()=>projectRows(state.projects.filter(p=>`${p.name} ${p.path}`.toLowerCase().includes(state.search.projects.toLowerCase())))],history:['#history-list',historyRows],plugins:['#plugin-list',pluginRows]};const [target,rows]=lists[el.dataset.search];$(target).innerHTML=rows();}
  });
  document.addEventListener('change',event=>{
    const el=event.target;const key=el.dataset.change;
    if(el.name==='keyAction'){$('#key-field').hidden=el.value!=='replace';$('#provider-key').disabled=el.value!=='replace';if(el.value!=='replace')$('#provider-key').value='';editor.dirty=true;return;}
    if(key==='raw-optin'){$('#raw-area').innerHTML=el.checked?`<label class="field">合成原始配置<textarea readonly class="raw-config" data-testid="raw-config">${esc(JSON.stringify({agent:state.agent,endpoint:'https://api.example.invalid/v1',apiKey:'DEMO_ONLY_NOT_A_REAL_SECRET',verified:false},null,2))}</textarea></label>`:'<p class="muted">原始配置已隐藏并清空。</p>';return;}
    if(key==='ssh-auth'){$('#ssh-auth-field').innerHTML=el.value==='agent'?'<div class="notice">模拟使用 SSH Agent，不检测或调用系统 Agent。</div>':el.value==='password'?'<div class="field"><label for="ssh-credential">演示密码（请勿输入真实密码）</label><input id="ssh-credential" type="password" autocomplete="off" placeholder="仅合成示例文本"></div>':textField('ssh-credential','演示私钥路径','~/.ssh/demo_key');return;}
    if(key==='project-override'){state.projectOverrides[project().name]=el.checked;render();return;}
    const mapping={'history-project':'historyProject','history-source':'historySource','usage-range':'usageRange','usage-scope':'usageScope','hooks':'hooks','background':'background'};
    if(mapping[key]){state[mapping[key]]=el.type==='checkbox'?el.checked:el.value;render();return;}
    if(key==='project'){state.project=+el.value;state.session=state.sessions.findIndex(s=>s.project===state.project);render();}
    if(key==='variant'){state.variant=el.value;if(el.value==='paper')state.theme='light';render();}
    if(key==='workspace'){state.workspace=el.value;render();toast('已切换演示工作区 · 示例项目列表共用');}
  });
  document.addEventListener('submit',event=>{
    const form=event.target;if(!form.dataset.form)return;event.preventDefault();const kind=form.dataset.form;
    if(kind==='terminal'){const input=$('input',form);toast(input.value.trim()?'演示终端不执行命令；输入未发送、未保存。':'请输入演示文本。');input.value='';return;}
    if(kind==='provider'){saveProvider();return;}
    const error=$('.form-error',form);const value=id=>$(id,form)?.value.trim()||'';
    if(kind==='ssh'){
      if(!value('#ssh-host').endsWith('.example.invalid')){error.textContent='请使用 *.example.invalid 演示主机。';return;}
      if(!/^\d+$/.test(value('#ssh-port'))||+value('#ssh-port')<1||+value('#ssh-port')>65535){error.textContent='端口应为 1–65535。';return;}
      const index=+form.dataset.hostIndex;
      const host={name:value('#ssh-name'),host:value('#ssh-host'),port:value('#ssh-port'),user:value('#ssh-user'),path:value('#ssh-path'),auth:$('#ssh-auth',form).value,status:'idle',fail:value('#ssh-host').startsWith('offline.')};
      if(index<0)state.sshHosts.push(host);else state.sshHosts[index]=host;
      closeModal(true);render();toast('演示主机列表已更新 · 不保存认证输入或建立连接');return;
    }
    if(kind==='shortcut'){if(value('#shortcut-key').toLowerCase()==='ctrl+b'){error.textContent='快捷键冲突：Ctrl+B 已用于切换侧栏。请选择其他组合。';return;}closeModal(true);toast('演示键位无冲突 · 实际键位保持不变');return;}
    if(kind==='new-session'){const name=value('#session-name');if(!name){error.textContent='请输入会话名称。';return;}state.sessions.push({name,agent:$('#session-agent',form).value,status:'空闲',project:state.project});state.session=state.sessions.length-1;closeModal(true);navigate('workspace');toast('演示会话已创建 · 未启动 CLI');}
    if(kind==='new-project'){const name=value('#project-name');if(!name){error.textContent='请输入项目名称。';return;}state.projects.push({name,path:value('#project-path'),branch:'demo',kind:'本地项目 · 示例'});closeModal(true);render();toast('项目已加入演示列表 · 未读取路径');}
    if(kind==='new-workspace'){const name=value('#workspace-name');if(!name){error.textContent='请输入工作区名称。';return;}if(!state.workspaces.includes(name))state.workspaces.push(name);state.workspace=name;closeModal(true);render();toast('已创建演示工作区 · 共用示例项目');}
  });
  for(const dialog of [modal,confirmation]) {
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(dialog===confirmation){pendingLeave=null;confirmation.close();}else closeModal();});
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const focusable=$$('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',dialog).filter(el=>el.getClientRects().length&&el.tabIndex>=0);
      const first=focusable[0],last=focusable.at(-1);if(!first)return;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    });
  }
  document.addEventListener('keydown',event=>{
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(modalKind==='quick')closeModal();else quickOpen();}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='b'&&!modal.open){event.preventDefault();actions.sidebar();}
    if(modalKind==='quick'&&!confirmation.open){
      if(['ArrowDown','ArrowUp'].includes(event.key)) {
        event.preventDefault();
        quickIndex=quickItems.length?(quickIndex+(event.key==='ArrowDown'?1:-1)+quickItems.length)%quickItems.length:0;
        filterQuick($('#quick-query').value);
        const item=$(`#quick-item-${quickIndex}`), list=$('#quick-results');
        if(item) {
          const r=item.getBoundingClientRect(), bounds=list.getBoundingClientRect();
          if(r.top<bounds.top)list.scrollTop-=bounds.top-r.top;
          else if(r.bottom>bounds.bottom)list.scrollTop+=r.bottom-bounds.bottom;
        }
      }
      if(event.key==='Enter'&&event.target.id==='quick-query'){event.preventDefault();selectQuick(quickIndex);}
    }
  });
  window.addEventListener('beforeunload',event=>{if(editor?.dirty){event.preventDefault();event.returnValue='';}});
  window.belfryPrototype={get state(){return JSON.parse(JSON.stringify({...state,providers:activeProviders(),providerDirty:!!editor?.dirty,modal:modalKind}));},navigate};
  render();
})();
