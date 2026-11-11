import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageView, MessagesView, SessionView, SessionsView } from "./contracts";
import { mergeMessages, useInbox, type InboxReadPorts } from "./useInbox";

// Exercise the real hook with controllable IPC completion order and timer turns.
const hooks = vi.hoisted(() => ({
  cursor: 0, slots: [] as unknown[], effects: [] as Array<() => void>, dirty: false, writes: 0,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const memo = <T,>(make: () => T, deps: unknown[]) => {
    const index = hooks.cursor++;
    const old = hooks.slots[index] as { deps: unknown[]; value: T } | undefined;
    if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) hooks.slots[index] = { deps, value: make() };
    return (hooks.slots[index] as { value: T }).value;
  };
  return { ...react,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.slots[index], (next: T | ((value: T) => T)) => {
        const value = typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        hooks.writes++;
        if (!Object.is(value, hooks.slots[index])) hooks.dirty = true;
        hooks.slots[index] = value;
      }];
    },
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useCallback: <T,>(callback: T, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      const index = hooks.cursor++;
      const old = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        const slot = { deps, cleanup: old?.cleanup };
        hooks.slots[index] = slot;
        hooks.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
});
vi.mock("../workspace/errors", () => ({ toAppFailure: (cause: unknown) => ({ message: String((cause as Error)?.message ?? cause) }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const status = (code: string) => ({ code, params: {} });
function session(key: string, at = 1, root = "/p"): SessionView {
  return { sessionKey: key, tabId: `tab-${key}`, name: key, agent: "codex", projectRoot: root, runtimeAvailability: "ready",
    summaryStatus: status("empty"), pendingCount: 0, awaitingReplyCount: 0, lastMessagePreview: null, lastMessageAt: at, oldestPendingAt: null };
}
function message(id: string, at: number, text = id, revision = 1): MessageView {
  return { id, messageId: `o-${id}`, revision, source: { kind: "room", roomId: "r", name: "room", messageId: `o-${id}` },
    recipient: { id: "r", sessionKey: "A", projectRoot: "/p", tabId: "tab-A", roomId: "r", memberId: "m", name: "A", agent: "codex" },
    topicId: "t", class: "discussion", by: { id: "b", name: "B", tabId: "tab-B", memberId: null }, createdAt: at, text,
    attachments: [], replyTo: null, questions: [], replies: [], deliveryPhase: "pending", deliveryStatus: status("queue_turn"),
    handlingStatus: status("unknown_handling"), waitingReason: null };
}
const sessions = (list: SessionView[], loadError: string | null = null): SessionsView => ({ schemaVersion: 1, revision: 1, generatedAt: 0, sessions: list, loadError });
const page = (list: MessageView[], nextCursor: string | null = null, revision = 1): MessagesView => ({ schemaVersion: 1, revision, messages: list, nextCursor, loadError: null });

let state: ReturnType<typeof useInbox>;
let ports: { sessions: ReturnType<typeof vi.fn>; messages: ReturnType<typeof vi.fn> };
let roots = ["/p"];
let roomId: string | null = null;
function render() {
  let turns = 0;
  do {
    if (++turns > 20) throw new Error("hook render did not settle");
    hooks.cursor = 0; hooks.dirty = false;
    state = useInbox(roots, true, ports as unknown as InboxReadPorts, roomId);
    hooks.effects.splice(0).forEach((effect) => effect());
  } while (hooks.dirty);
}
function unmount() { hooks.slots.forEach((slot) => (slot as { cleanup?: () => void } | null)?.cleanup?.()); }
async function flush(ms = 0) { await vi.advanceTimersByTimeAsync(ms); render(); }

beforeEach(async () => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.dirty = false; hooks.writes = 0;
  vi.useFakeTimers();
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
  roots = ["/p"]; roomId = null;
  ports = {
    sessions: vi.fn(async () => sessions([session("A", 2), session("B", 1)])),
    messages: vi.fn(async ({ sessionKey }: { sessionKey: string }) => page([message(`${sessionKey}1`, 1)])),
  };
  render(); await flush();
});
afterEach(() => { unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useInbox 读取", () => {
  it("列表按最近消息排序，打开前不读消息", async () => {
    expect(state.sessions.map((s) => s.sessionKey)).toEqual(["A", "B"]);
    expect(ports.messages).not.toHaveBeenCalled();
  });

  it("A/B 乱序返回：先选 A 后选 B，A 的迟到响应不覆盖 B", async () => {
    const slowA = deferred<MessagesView>();
    ports.messages.mockReturnValueOnce(slowA.promise);
    state.select("A"); await flush();
    state.select("B"); await flush();
    slowA.resolve(page([message("stale-A", 9)])); await flush();
    expect(state.selected).toBe("B");
    expect(state.messages.map((m) => m.id)).toEqual(["B1"]);
  });

  it("返回列表后迟到的消息响应被丢弃", async () => {
    const slow = deferred<MessagesView>();
    ports.messages.mockReturnValueOnce(slow.promise);
    state.select("A"); await flush();
    state.select(null); await flush();
    slow.resolve(page([message("late", 1)])); await flush();
    expect(state.messages).toEqual([]);
  });

  it("旧的列表请求晚于新请求返回时不覆盖", async () => {
    const old = deferred<SessionsView>();
    ports.sessions.mockReturnValueOnce(old.promise);
    void state.refresh(); await flush();
    ports.sessions.mockResolvedValueOnce(sessions([session("C", 5)]));
    void state.refresh(); await flush();
    old.resolve(sessions([session("OLD", 9)])); await flush();
    expect(state.sessions.map((s) => s.sessionKey)).toEqual(["C"]);
  });

  it("读取失败保留上次结果并显示错误，不伪装成没有会话", async () => {
    ports.sessions.mockRejectedValueOnce(new Error("disk busy"));
    await flush(1_500);
    expect(state.sessions.map((s) => s.sessionKey)).toEqual(["A", "B"]);
    expect(state.error).toBe("disk busy");
    await flush(1_500);
    expect(state.error).toBeNull();
  });

  it("后端 loadError 也保留列表并显示", async () => {
    ports.sessions.mockResolvedValueOnce(sessions([session("A", 2)], "store version unknown"));
    await flush(1_500);
    expect(state.error).toBe("store version unknown");
  });

  it("多个项目逐个查询并按 sessionKey 合并", async () => {
    unmount(); hooks.slots = []; hooks.effects = [];
    roots = ["/p", "/q"];
    ports.sessions.mockImplementation(async (root: string) => sessions(root === "/p" ? [session("A", 2)] : [session("Q", 3, "/q"), session("A", 1)]));
    render(); await flush();
    expect(ports.sessions.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["/p", "/q"]));
    expect(state.sessions.map((s) => s.sessionKey)).toEqual(["Q", "A"]);
  });

  it("翻页：游标原样回传，较早消息并入且不重复；切会话后迟到的翻页结果被丢弃", async () => {
    ports.messages.mockResolvedValueOnce(page([message("m3", 3), message("m4", 4)], "opaque:cursor/1"));
    state.select("A"); await flush();
    expect(state.hasOlder).toBe(true);
    const older = deferred<MessagesView>();
    ports.messages.mockReturnValueOnce(older.promise);
    void state.loadOlder(); await flush();
    expect(ports.messages).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "A", cursor: "opaque:cursor/1" }));
    older.resolve(page([message("m1", 1), message("m3", 3)], null)); await flush();
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m3", "m4"]);
    expect(state.hasOlder).toBe(false);

    ports.messages.mockResolvedValueOnce(page([message("x", 1)], "c2"));
    state.select("B"); await flush();
    const late = deferred<MessagesView>();
    ports.messages.mockReturnValueOnce(late.promise);
    void state.loadOlder(); await flush();
    state.select("A"); await flush();
    late.resolve(page([message("from-B", 0)])); await flush();
    expect(state.messages.some((m) => m.id === "from-B")).toBe(false);
  });

  it("轮询新消息时并入同一会话，保留已加载的更早页", async () => {
    ports.messages.mockResolvedValueOnce(page([message("m2", 2)], "c"));
    state.select("A"); await flush();
    ports.messages.mockResolvedValueOnce(page([message("m1", 1)], null));
    await state.loadOlder(); await flush();
    ports.messages.mockResolvedValueOnce(page([message("m2", 2, "m2", 2), message("m5", 5)]));
    await flush(1_500);
    expect(state.messages.map((m) => m.id)).toEqual(["m1", "m2", "m5"]);
  });
});

describe("mergeMessages", () => {
  it("同 id 以较新 revision 为准，不被旧数据回滚", () => {
    const merged = mergeMessages([message("a", 1, "new", 3)], [message("a", 1, "old", 2)]);
    expect(merged[0].text).toBe("new");
  });
});

describe("已展开历史与项目范围", () => {
  it("旧页问题收到答复后会刷新，且不改变历史游标", async () => {
    const question = { ...message("old", 1), questions: [{ id: "q", text: "confirm?", state: "open" as const, replyMessageIds: [], legacy: false }] };
    ports.messages.mockResolvedValueOnce(page([message("latest", 3)], "older"));
    state.select("A"); await flush();
    ports.messages.mockResolvedValueOnce(page([question, message("middle", 2)], "oldest"));
    await state.loadOlder(); await flush();
    ports.messages.mockImplementation(async ({ cursor }: { cursor?: string }) => cursor
      ? page([{ ...question, revision: 2, questions: [{ ...question.questions[0], state: "replied", replyMessageIds: ["answer"] }] }, message("middle", 2)], "oldest", 2)
      : page([message("latest", 3)], "older", 2));
    await flush(1_500);
    expect(state.messages.find((item) => item.id === "old")?.questions[0].state).toBe("replied");
    expect(state.hasOlder).toBe(true);
    ports.messages.mockResolvedValueOnce(page([message("earliest", 0)]));
    await state.loadOlder(); await flush();
    expect(ports.messages).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "oldest" }));
  });

  it("一轮出现多页新消息时补齐中间页，不跳过原文", async () => {
    ports.messages.mockResolvedValueOnce(page([message("m4", 4), message("m5", 5)], "after3"));
    state.select("A"); await flush();
    ports.messages.mockImplementation(async ({ cursor }: { cursor?: string }) => {
      if (cursor === "after7") return page([message("m6", 6), message("m7", 7)], "after5", 2);
      if (cursor === "after5") return page([message("m4", 4), message("m5", 5)], "after3", 2);
      return page([message("m8", 8), message("m9", 9)], "after7", 2);
    });
    await flush(1_500);
    expect(state.messages.map((item) => item.id)).toEqual(["m4", "m5", "m6", "m7", "m8", "m9"]);
  });

  it("移出选中会话所属项目时立即清除详情，迟到旧页不能恢复", async () => {
    ports.messages.mockResolvedValueOnce(page([message("old-project", 1)], "older"));
    state.select("A"); await flush();
    const old = deferred<MessagesView>();
    ports.messages.mockImplementationOnce(() => old.promise);
    const loading = state.loadOlder();
    ports.sessions.mockResolvedValue(sessions([session("Q", 3, "/q")]));
    roots = ["/q"]; render(); await flush();
    expect(state.selected).toBeNull();
    expect(state.messages).toEqual([]);
    old.resolve(page([message("late-old", 0)])); await loading; await flush();
    expect(state.messages).toEqual([]);
    expect(state.hasOlder).toBe(false);
  });
});

describe("房间内收件箱", () => {
  it("按房间读取会话与消息，换房间清除旧选择并丢弃旧房间的迟到响应", async () => {
    unmount(); hooks.cursor = 0; hooks.slots = []; hooks.effects = [];
    roomId = "room-1"; ports.sessions.mockClear(); ports.messages.mockClear();
    render(); await flush();
    expect(ports.sessions).toHaveBeenLastCalledWith("/p", "room-1");
    const slow = deferred<MessagesView>();
    ports.messages.mockReturnValueOnce(slow.promise);
    state.select("A"); await flush();
    expect(ports.messages).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "A", roomId: "room-1" }));
    roomId = "room-2"; render(); await flush();
    expect(state.selected).toBeNull();
    expect(ports.sessions).toHaveBeenLastCalledWith("/p", "room-2");
    slow.resolve(page([message("stale-room-1", 9)])); await flush();
    expect(state.messages).toEqual([]);
  });
});
