import { uiFixture, click, waitFor } from "./production-uiFixture.mjs";

// Exercise the shipped, lazily loaded room bundle with synthetic IPC only.
export async function recipientFixture(t, { longNames = false, many = false, empty = false, noForeman = false, locale = "zh-CN", platform = "macos", mode = "dark", fontSize = 15 } = {}) {
  const titles = locale === "en" ? ["Planner", "Frontend", "Backend", "QA"]
    : longNames ? ["资深全栈工程师与项目统筹负责人", "前端交互与用户体验设计工程师", "后端服务与数据架构工程师", "测试与质量保障工程师"]
      : ["统筹员", "前端", "后端", "测试"];
  const at = Date.UTC(2026, 10, 13, 7, 30);
  const members = empty ? [] : Array.from({ length: many ? 18 : 4 }, (_, index) => ({
    id: `recipient-${index}`, tabId: `recipient-tab-${index}`, title: titles[index] ?? `协作工程师${index}`,
    duty: locale === "en" ? ["Plan and coordinate", "Interface and interactions", "APIs and data", "Regression testing"][index] ?? "Implementation"
      : ["拆解需求、分派任务、跟进交付", "界面设计与交互实现", "服务接口与数据处理", "回归测试与质量验收"][index] ?? "开发与交付",
    role: index === 0 && !noForeman ? "foreman" : "peer", agent: "codex", joinedAt: at, leftAt: null,
  }));
  const room = { id: "recipient-room", name: locale === "en" ? "UI design" : "UI 设计", projectRoot: "/qa/synthetic-project", createdAt: at,
    brief: { objective: locale === "en" ? "Refine the room recipient selector" : "优化人员选择体验，让沟通对象清晰可见。", currentFocus: "", constraints: [], updatedAt: at, updatedBy: "user" },
    members, tasks: [], nextTask: 1, paused: false, messages: [
      { id: "recipient-message", at, kind: "chat", by: members[0]?.id ?? "user", text: locale === "en" ? "The design is ready for review." : "设计规范已经确认，可以继续完善交互细节。", to: ["user"], mode: "send", replyTo: null, deliveredTo: [], repliedBy: [], replyCancelled: false },
    ] };
  const nativeExtension = `(() => {
    localStorage.setItem('belfry.locale.v1', ${JSON.stringify(locale)});
    localStorage.setItem('belfry.theme.v1', ${JSON.stringify(mode)});
    localStorage.setItem('belfry.typography.v1', JSON.stringify({ fontFamily: null, fontSize: ${fontSize}, activeImportedFont: null, importedFonts: [] }));
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ${JSON.stringify(platform === "macos" ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" : "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")} });
    const room = ${JSON.stringify(room)};
    const summary = { id: room.id, name: room.name, projectRoot: room.projectRoot, createdAt: room.createdAt, objective: room.brief.objective,
      memberCount: room.members.length, memberTabIds: room.members.map(m => m.tabId), memberTitles: room.members.map(m => m.title),
      foreman: room.members.find(m => m.role === 'foreman')?.title ?? null, openTasks: 0, doneTasks: 0, lastMessageAt: room.createdAt, paused: false, lastToUser: null };
    const original = __TAURI_INTERNALS__.invoke;
    __TAURI_INTERNALS__.invoke = async (command, args = {}) => {
      if (!['room_list', 'room_get', 'room_history', 'room_say'].includes(command)) return original(command, args);
      __productionQA.calls.push({ command, args });
      if (command === 'room_list') return { rooms: [summary], loadError: null };
      if (command === 'room_history') return { entries: [], nextCursor: null, ledgerBytes: 0, snapshotBytes: 0 };
      if (command === 'room_say') room.messages.push({ ...room.messages[0], id: 'sent-' + room.messages.length, by: 'user', text: args.text, to: args.to });
      return structuredClone(room);
    };
  })();`;
  const fixture = await uiFixture(t, { nativeExtension });
  const { view } = fixture;
  await click(view, locale === "en" ? 'button[title^="Collaboration rooms"]' : 'button[title^="协作房间"]');
  await waitFor(view, "!!document.querySelector('.room-composer textarea')");
  return { ...fixture, titles };
}
