// TEST ONLY: synthetic room IPC extension for the collaboration room view.
// Never reads HOME, credentials, project files or PTYs; rooms live in sessionStorage for this tab.
(() => {
  const qa = window.__productionQA;
  // 与 production-uiNative.js 合成项目一致：回执里的路径要落在项目根内，才能开预览。
  const projectRoot = "/qa/synthetic-project/very-long-directory-name-for-layout-coverage/packages/workbench";
  qa.notifications = [];
  // 插件先看 window.Notification.permission 再决定要不要走原生命令，
  // 替身必须带上静态 permission / requestPermission 才不会被判成「没权限」。
  Object.defineProperty(window, "Notification", { configurable: true, writable: true,
    value: class SyntheticNotification {
      static permission = "granted";
      static requestPermission = () => Promise.resolve("granted");
      constructor(title, options) { qa.notifications.push({ title, options }); }
    } });

  // 剪贴板：导出验证记录用；写入内容记录下来给用例断言。
  qa.clipboard = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: (text) => { qa.clipboard.push(text); return Promise.resolve(); } } });
  const original = window.__TAURI_INTERNALS__.invoke;
  // 房间只活在这份合成存储里，但房间独立窗口是整页加载：过一遍 sessionStorage，
  // 让「主窗口建好的房间」在跳过去的那个页面里还在（真实实现里它们在磁盘上）。
  const STORE_KEY = "belfry.rooms.qa.store.v1";
  const restored = (() => { try { return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null"); } catch { return null; } })();
  let sequence = Number(restored?.sequence) || 0;
  const freshId = (prefix) => `${prefix}-qa-${++sequence}`;
  const rooms = Array.isArray(restored?.rooms) ? restored.rooms : [];
  window.addEventListener("pagehide", () => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ rooms, sequence })); } catch { /* 存不下就只是下次整页加载看不到房间 */ }
  });

  const findRoom = (id) => {
    const room = rooms.find((item) => item.id === id);
    if (!room) throw new Error("找不到房间");
    return room;
  };
  const findTask = (room, taskId) => {
    const task = room.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("找不到这条任务");
    return task;
  };
  const summarize = (text) => (text.length > 18 ? `${text.slice(0, 18)}…` : text);
  const liveMembers = (room) => room.members.filter((member) => member.leftAt === null);
  // 与 store.rs 的 parse_mentions 同一把尺：长角色名先匹配并遮住短名，词的一部分不算点名。
  const mentionedMembers = (room, text) => {
    const candidates = [...liveMembers(room)].sort((left, right) => [...right.role].length - [...left.role].length);
    const spans = [];
    const found = [];
    for (const member of candidates) {
      const needle = `@${member.role}`;
      let from = 0;
      for (;;) {
        const at = text.indexOf(needle, from);
        if (at < 0) break;
        const end = at + needle.length;
        const next = [...text.slice(end)][0];
        const boundary = next === undefined || !/[\p{L}\p{N}]/u.test(next);
        const shadowed = spans.some(([start, stop]) => at < stop && start < end);
        if (boundary && !shadowed) { spans.push([at, end]); found.push({ member, at }); break; }
        from = end;
      }
    }
    found.sort((left, right) => left.at - right.at);
    return found.map((entry) => entry.member);
  };
  const systemNote = (room, text) => {
    room.messages.push({ id: freshId("msg"), at: Date.now(), kind: "system", author: "system", text, memberIds: [], taskId: null });
  };
  // 与 rooms/store.rs 的 refresh_stage 同一套优先级；对账后前端看到的阶段必须一致。
  const refreshStage = (task) => {
    const states = task.deliveries.map((delivery) => delivery.state);
    if (task.verifiedAt) task.stage = "verified";
    else if (task.rejectedAt) task.stage = "rejected";
    else if (task.stoppedAt) task.stage = "stopped";
    else if (states.includes("failed")) task.stage = "failed";
    else if (states.length > 0 && states.every((state) => state === "done")) task.stage = "submitted";
    else if (states.some((state) => state === "done" || state === "dispatched")) task.stage = "running";
    else if (states.some((state) => state === "abandoned" || state === "unknown")) task.stage = "interrupted";
    else task.stage = "dispatching";
  };
  const summarizeRoom = (room) => ({
    id: room.id, name: room.name, projectRoot: room.projectRoot, createdAt: room.createdAt,
    memberTabIds: liveMembers(room).map((member) => member.tabId),
    memberCount: liveMembers(room).length,
    activeTaskCount: room.tasks.filter((task) => ["dispatching", "running", "submitted"].includes(task.stage)).length,
    // 与 Rust 侧一致：时间线最新一条的时刻，前端按它画房间列表未读标记。
    lastMessageAt: room.messages.length ? Math.max(...room.messages.map((message) => message.at)) : null,
  });

  const handlers = {
    // 独立窗口：真实实现由 Rust 起窗；合成环境里只记录调用。
    room_open_window: () => null,
    // 独立窗口的在场状态：与真实主窗口一样，从房间成员还原一份名册。
    collab_sessions: () => rooms.flatMap((room) => liveMembers(room).map((member) => ({
      tabId: member.tabId, name: member.role, title: member.role, agent: member.agent,
      activity: "idle", canReceive: true, projectRoot: room.projectRoot,
    }))),
    room_list: () => ({ rooms: rooms.map(summarizeRoom), loadError: null }),
    room_pending_reviews: () => rooms.flatMap((room) =>
      room.tasks.filter((task) => task.stage === "submitted").map((task) =>
        ({ roomId: room.id, roomName: room.name, taskId: task.id, title: task.title }))),
    room_get: ({ id }) => findRoom(id),
    room_create: ({ name, projectRoot }) => {
      const room = { id: freshId("room"), name, projectRoot, extraRoots: [], createdAt: Date.now(), members: [], messages: [], decisions: [], tasks: [] };
      rooms.push(room);
      return room;
    },
    room_rename: ({ id, name }) => { const room = findRoom(id); room.name = name; return room; },
    room_delete: ({ id }) => {
      const index = rooms.findIndex((item) => item.id === id);
      if (index >= 0) rooms.splice(index, 1);
      return null;
    },
    room_add_member: ({ id, tabId, agent, role, duty, projectRoot }) => {
      const room = findRoom(id);
      let finalRole = role;
      // 角色名在房间内唯一：重名就像 store.rs 一样往后编号。
      for (let suffix = 2; liveMembers(room).some((member) => member.role === finalRole); suffix++) finalRole = `${role} ${suffix}`;
      room.members.push({ id: freshId("member"), tabId, agent, role: finalRole, duty, joinedAt: Date.now(), leftAt: null });
      // 与 Rust 侧一致：带过来的项目不在范围内就顺势扩展，只增不减。
      if (projectRoot && projectRoot !== room.projectRoot && !room.extraRoots.includes(projectRoot)) {
        room.extraRoots.push(projectRoot);
        systemNote(room, `房间的接活范围扩展到「${projectRoot}」。`);
      }
      return room;
    },
    room_update_member: ({ id, memberId, role, duty, tabId }) => {
      const room = findRoom(id);
      const member = room.members.find((item) => item.id === memberId);
      if (!member) throw new Error("找不到成员");
      if (role !== undefined) member.role = role;
      if (duty !== undefined) member.duty = duty;
      if (tabId !== undefined) member.tabId = tabId;
      return room;
    },
    room_remove_member: ({ id, memberId }) => {
      const room = findRoom(id);
      const member = room.members.find((item) => item.id === memberId);
      if (member) member.leftAt = Date.now();
      return room;
    },
    room_send_message: ({ id, text, replyTo }) => {
      const room = findRoom(id);
      room.messages.push({ id: freshId("msg"), at: Date.now(), kind: "user", author: "user", text, memberIds: [], taskId: null, deliveredTo: [], replyTo: replyTo ?? null });
      return room;
    },
    room_recall: ({ id, messageId }) => {
      // 与 Rust 侧一致：标记撤回；已经送出去的回执保留（界面据此说明撤不回来）。
      const room = findRoom(id);
      const message = room.messages.find((item) => item.id === messageId);
      if (!message) throw new Error("找不到这条消息");
      if (message.recalledAt) throw new Error("这条消息已经撤回了");
      if (message.taskId) throw new Error("派活消息不能撤回");
      message.recalledAt = Date.now();
      return room;
    },
    room_clear_messages: ({ id }) => {
      // 与 Rust 侧一致：只清时间线；任务、决定与投递记录保留。
      const room = findRoom(id);
      room.messages = [];
      return room;
    },
    room_react: ({ id, messageId, emoji }) => {
      // 与 Rust 侧一致：用户视角的切换（点过再点是取消）。
      const room = findRoom(id);
      const message = room.messages.find((item) => item.id === messageId);
      if (!message) throw new Error("找不到这条消息");
      message.reactions = message.reactions ?? [];
      const index = message.reactions.findIndex((reaction) => reaction.memberId === "user" && reaction.emoji === emoji);
      if (index >= 0) message.reactions.splice(index, 1);
      else message.reactions.push({ memberId: "user", emoji, at: Date.now() });
      return room;
    },
    room_mark_decision: ({ id, messageId }) => {
      const room = findRoom(id);
      if (!room.decisions.some((decision) => decision.messageId === messageId)) {
        const message = room.messages.find((item) => item.id === messageId);
        room.decisions.push({ id: freshId("decision"), at: Date.now(), by: "user", text: message ? message.text : "", messageId });
      }
      return room;
    },
    room_dispatch: ({ id, text, memberIds, acceptance }) => {
      const room = findRoom(id);
      const task = { id: freshId("task"), title: summarize(text), text, memberIds: [...memberIds], acceptance: acceptance ?? [],
        createdAt: Date.now(), stage: "dispatching", attempt: 1, verifiedAt: null, verificationNote: null, rejectedAt: null, rejectionNote: null, stoppedAt: null,
        deliveries: memberIds.map((memberId) => ({ memberId, busTaskId: freshId("bus"), state: "queued", result: null, at: Date.now() })) };
      refreshStage(task);
      room.tasks.push(task);
      room.messages.push({ id: freshId("msg"), at: Date.now(), kind: "user", author: "user", text, memberIds: [...memberIds], taskId: task.id });
      return room;
    },
    room_broadcast: ({ id, text, replyTo }) => {
      // 与 Rust 侧一致：群聊通道——只落一条消息，不建交差任务、不生成任务卡；
      // 点名收窄到被点的人，不点名才发给全体。
      const room = findRoom(id);
      const mentioned = mentionedMembers(room, text);
      const audience = mentioned.length > 0 ? mentioned : liveMembers(room);
      room.messages.push({ id: freshId("msg"), at: Date.now(), kind: "user", author: "user", text, memberIds: audience.map((member) => member.id), taskId: null, deliveredTo: [], replyTo: replyTo ?? null });
      return room;
    },
    room_stop_task: ({ id, taskId }) => {
      const room = findRoom(id);
      const task = findTask(room, taskId);
      task.stoppedAt = Date.now();
      for (const delivery of task.deliveries) if (delivery.state === "queued" || delivery.state === "dispatched") delivery.state = "abandoned";
      refreshStage(task);
      systemNote(room, `已停止派发「${task.title}」`);
      return room;
    },
    room_verify_task: ({ id, taskId, note }) => {
      const room = findRoom(id);
      const task = findTask(room, taskId);
      task.verifiedAt = Date.now();
      task.verificationNote = note ?? null;
      refreshStage(task);
      systemNote(room, `已验证「${task.title}」`);
      return room;
    },
    room_reject_task: ({ id, taskId, feedback }) => {
      const room = findRoom(id);
      const task = findTask(room, taskId);
      if (task.stage !== "submitted") throw new Error("只有「已提交待验证」的任务可以退回重做");
      task.rejectedAt = Date.now();
      task.rejectionNote = feedback;
      refreshStage(task);
      const text = `${task.text}\n\n上一轮验证未通过，退回重做。要求：${feedback}`;
      const followUp = { id: freshId("task"), title: `（退回）${task.title}`, text, memberIds: [...task.memberIds],
        acceptance: [...task.acceptance], createdAt: Date.now(), stage: "dispatching", attempt: 1,
        deliveries: task.memberIds.map((memberId) => ({ memberId, busTaskId: freshId("bus"), state: "queued", result: null, at: Date.now() })),
        verifiedAt: null, verificationNote: null, rejectedAt: null, rejectionNote: null, stoppedAt: null };
      refreshStage(followUp);
      room.tasks.push(followUp);
      room.messages.push({ id: freshId("msg"), at: Date.now(), kind: "user", author: "user", text, memberIds: [...task.memberIds], taskId: followUp.id });
      systemNote(room, `任务「${task.title}」验证未通过，已退回重做；带反馈的跟进任务已派出。`);
      return room;
    },
    room_retry_task: ({ id, taskId, memberIds }) => {
      const room = findRoom(id);
      const task = findTask(room, taskId);
      const targets = memberIds && memberIds.length > 0 ? memberIds : task.memberIds;
      task.attempt += 1;
      for (const delivery of task.deliveries) {
        if (targets.includes(delivery.memberId)) {
          delivery.busTaskId = freshId("bus");
          delivery.state = "queued";
          delivery.result = null;
          delivery.at = Date.now();
        }
      }
      refreshStage(task);
      systemNote(room, `重新派发「${task.title}」（第 ${task.attempt} 轮）`);
      return room;
    },
    // 通知走通整条路：权限直接放行；插件在 JS 层用 new Notification(...) 投递，
    // 这里换成合成构造器把标题与正文记录下来，给用例断言。
    "plugin:notification|is_permission_granted": () => true,
    "plugin:notification|request_permission": () => "granted",
  };

  window.__roomsQA = {
    rooms,
    /** 模拟成员说话（真实实现是 belfry room say）：按角色找到最近的房间与成员；
     *  replyTo 传被引用消息的 id（真实实现里是 `room say --reply <短id>`）。 */
    say(role, text, mentionRoles = [], replyTo = null) {
      for (let i = rooms.length - 1; i >= 0; i--) {
        const room = rooms[i];
        const member = liveMembers(room).find((item) => item.role === role);
        if (!member) continue;
        const mentioned = mentionRoles
          .map((mention) => liveMembers(room).find((item) => item.role === mention))
          .filter(Boolean);
        room.messages.push({ id: freshId("msg"), at: Date.now(), kind: "member", author: member.id,
          text, memberIds: mentioned.map((item) => item.id), taskId: null, replyTo: replyTo ?? null });
        return room;
      }
      throw new Error(`没有找到角色「${role}」的成员`);
    },
    /** 模拟成员敲了 belfry done 之后对账的样子：在跑的投递全部交差。 */
    settle(result = `合成回执：改完了，见 ${projectRoot}/src/login.ts`) {
      for (const room of rooms) for (const task of room.tasks) {
        for (const delivery of task.deliveries) {
          if (delivery.state === "queued" || delivery.state === "dispatched") {
            delivery.state = "done";
            delivery.result = result;
          }
        }
        if (task.deliveries.some((delivery) => delivery.state === "done")) {
          // 与 Rust 侧对账采集对应：交差即带上工作区快照。
          task.artifact = { capturedAt: Date.now(), truncated: false,
            text: "diff --git a/src/login.ts b/src/login.ts\n-旧的提示\n+内联的错误提示" };
        }
        refreshStage(task);
      }
    },
    /**
     * 模拟成员终端刷了一帧「生成中」（真实实现是 Claude / Codex 的 spinner 文案）。
     *
     * 走真正的 terminal_write：输出会广播给这条会话的每一路视图——工作台那一路与
     * 房间里看终端那一路都要收到。成员行的在场状态读的是工作台那一路的判定，
     * 它要是被看终端顶掉，左边就会一直显示「空闲」而右边在动。
     */
    busy(role, text = "✻ Thinking… (esc to interrupt)") {
      for (let i = rooms.length - 1; i >= 0; i--) {
        const member = liveMembers(rooms[i]).find((item) => item.role === role);
        if (!member) continue;
        return window.__TAURI_INTERNALS__.invoke("terminal_write",
          { sessionId: `${member.tabId}-pty`, bytes: Array.from(new TextEncoder().encode(text)) });
      }
      throw new Error(`没有找到角色「${role}」的成员`);
    },
    /**
     * 模拟成员恢复空闲：刷出足够多的「内容行」，把生成中的状态行挤出活动扫描窗口。
     * 不能只写空行——判定先修剪尾部空行，spinner 仍会留在窗口里。
     */
    idle(role) {
      for (let i = rooms.length - 1; i >= 0; i--) {
        const member = liveMembers(rooms[i]).find((item) => item.role === role);
        if (!member) continue;
        const text = "\n" + Array.from({ length: 14 }, (_, index) => `输出 ${index}`).join("\n") + "\n$ ";
        return window.__TAURI_INTERNALS__.invoke("terminal_write",
          { sessionId: `${member.tabId}-pty`, bytes: Array.from(new TextEncoder().encode(text)) });
      }
      throw new Error(`没有找到角色「${role}」的成员`);
    },
    /**
     * 模拟群聊送达：把最近一条还没收齐回执的群聊消息标记为已送达——
     * 真实实现里这是对账（reconcile）把「进过谁的终端」写回消息。
     */
    delivered() {
      for (let i = rooms.length - 1; i >= 0; i--) {
        const room = rooms[i];
        const message = [...room.messages].reverse().find((item) => item.kind === "user" && !item.taskId
          && item.memberIds.length > 0 && (!item.deliveredTo || item.deliveredTo.length < item.memberIds.length));
        if (!message) continue;
        message.deliveredTo = [...message.memberIds];
        return room;
      }
      throw new Error("没有还在等送达回执的群聊消息");
    },
    /** 模拟任务表丢了：在跑的投递如实回写为「结果未知」。 */
    markUnknown() {
      for (const room of rooms) for (const task of room.tasks) {
        for (const delivery of task.deliveries) {
          if (delivery.state === "queued" || delivery.state === "dispatched") delivery.state = "unknown";
        }
        refreshStage(task);
      }
    },
  };

  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (handlers[command]) { qa.calls.push({ command, args }); return structuredClone(await handlers[command](args)); }
    return original(command, args);
  };
})();
