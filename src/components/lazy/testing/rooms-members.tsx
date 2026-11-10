// Isolated RoomView + public API boundary. No live room or terminal is used.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { setLocalePreference } from "../../../i18n";
import { agentDescriptor } from "../../../agent/contracts";
import type { AgentKind } from "../../../agent/contracts";
import * as api from "../../../rooms/api";
import type { Room, RoomMember, RoomSummary, RoomTaskOp } from "../../../rooms/contracts";
import type { WorkspaceTab } from "../../../workspace/contracts";
import "../../../styles.css";

const params = new URLSearchParams(location.search);
setLocalePreference(params.get("locale") === "zh-CN" ? "zh-CN" : "en");
const project = { id: "member-qa-project", name: "member-qa", rootPath: "/qa/member-project", rootUri: "file:///qa/member-project" };
const member = (id: string, title: string, duty: string, role: RoomMember["role"] = "peer"): RoomMember => ({
  id, title, duty, role, agent: "codex", tabId: `tab-${id}`, joinedAt: 100, leftAt: null,
});
const seed = (id: string, name: string): Room => ({ id, name, projectRoot: project.rootPath, createdAt: 100,
  brief: { objective: "Inspect generic samples", currentFocus: "", constraints: [], updatedBy: null, updatedAt: null },
  members: [member(`${id}-planner`, "Guide", "Coordinate sample checks", "foreman"),
    member(`${id}-atlas`, "Atlas", "Map symbols and colors"), member(`${id}-birch`, "Birch", "Check sentence rhythm")],
  messages: [], tasks: [], nextTask: 1,
});
const saved = sessionStorage.getItem("room-members-qa");
const rooms = new Map<string, Room>((saved ? JSON.parse(saved) : params.has("empty") ? []
  : [seed("room-a", "Sample room A"), seed("room-b", "Sample room B")]).map((room: Room) => [room.id, room]));
const persist = () => sessionStorage.setItem("room-members-qa", JSON.stringify([...rooms.values()]));
const active = (room: Room) => room.members.filter(member => member.leftAt === null);
const summary = (room: Room): RoomSummary => ({ id: room.id, name: room.name, projectRoot: room.projectRoot,
  createdAt: room.createdAt, objective: room.brief.objective, memberCount: active(room).length,
  memberTabIds: active(room).map(member => member.tabId), memberTitles: active(room).map(member => member.title),
  foreman: active(room).find(member => member.role === "foreman")?.title ?? null,
  openTasks: room.tasks.filter(task => task.status === "planned" || task.status === "active").length,
  doneTasks: room.tasks.filter(task => task.status === "done").length, lastMessageAt: null, paused: false, lastToUser: null,
});
const qa = {
  calls: [] as { command: string; args: Record<string, unknown>; result?: unknown; error?: string }[],
  launches: [] as { kind: string; root: string; tabId: string }[], renames: [] as { tabId: string; title: string }[],
  errors: [] as string[], failNext: "", show: (_open: boolean) => {},
  snapshot: () => structuredClone([...rooms.values()]),
  reorder: (id: string, ids: string[]) => {
    const room = rooms.get(id)!;
    room.members.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); persist();
  },
  update: api.roomUpdateMember, remove: api.roomRemoveMember, add: api.roomAddMember, task: api.roomTask,
};
Object.assign(window, { roomMembersQA: qa, qaSetLocale: setLocalePreference });
addEventListener("error", event => qa.errors.push(event.message));
addEventListener("unhandledrejection", event => qa.errors.push(String(event.reason)));

function normalizeTitle(room: Room, raw: string, except?: string) {
  const title = raw.trim().replace(/^@+/, "").trim();
  if (!title || active(room).some(member => member.id !== except && member.title.toLowerCase() === title.toLowerCase())) {
    throw new Error("Duplicate or empty role name");
  }
  return title;
}
// T52 extends the existing name-based task API with exact member IDs. Both
// inputs remain accepted here so the same fixture demonstrates the old UI bug.
function assigneeId(room: Room, raw?: string | null) {
  if (!raw) return null;
  const member = active(room).find(member => member.id === raw)
    ?? active(room).find(member => member.title.toLowerCase() === raw.trim().replace(/^@+/, "").toLowerCase());
  if (!member) throw new Error("Selected member is no longer present");
  return member.id;
}
function dispatch(command: string, args: Record<string, unknown>) {
  if (command === "project_open") return project;
  if (command === "room_list") return { rooms: [...rooms.values()].map(summary), loadError: null };
  if (command === "room_create") {
    const room: Room = { ...seed(`created-${rooms.size}`, String(args.name)), members: [],
      brief: { objective: String(args.objective), currentFocus: "", constraints: [], updatedAt: null, updatedBy: null } };
    rooms.set(room.id, room); persist(); return room;
  }
  if (command === "room_clipboard_files") return [];
  if (command === "plugin:event|listen") return 1;
  if (command.startsWith("plugin:")) return null;
  const room = rooms.get(String(args.id));
  if (!room) throw new Error(`Unknown isolated room: ${args.id}`);
  if (command === "room_get" || command === "room_say") return room;
  if (command === "room_add_member") {
    const title = normalizeTitle(room, String(args.title));
    if (active(room).some(member => member.tabId === args.tabId)) throw new Error("Session already belongs to a member");
    const foreman = args.foreman || !active(room).some(member => member.role === "foreman");
    if (foreman) active(room).forEach(member => { member.role = "peer"; });
    room.members.push({ ...member(`saved-${crypto.randomUUID()}`, title, String(args.duty).trim(), foreman ? "foreman" : "peer"),
      tabId: String(args.tabId), agent: String(args.agent) });
  } else if (command === "room_update_member") {
    const member = active(room).find(member => member.id === args.memberId);
    if (!member) throw new Error("Unknown member ID");
    if (typeof args.title === "string") member.title = normalizeTitle(room, args.title, member.id);
    if (typeof args.duty === "string") member.duty = args.duty.trim();
    if (typeof args.tabId === "string") member.tabId = args.tabId;
  } else if (command === "room_remove_member") {
    const member = active(room).find(member => member.id === args.memberId);
    if (!member) throw new Error("Unknown member ID");
    member.leftAt = Date.now();
    for (const task of room.tasks) if (task.assignee === member.id && ["planned", "active"].includes(task.status)) task.assignee = null;
  } else if (command === "room_task") {
    const op = args.op as RoomTaskOp;
    if (op.op === "add") room.tasks.push({ id: `T${room.nextTask++}`, title: op.title, outcome: op.outcome ?? "", status: "planned",
      assignee: assigneeId(room, op.assignee), blockedBy: op.after ?? [], notes: "", result: null,
      createdBy: "user", createdAt: Date.now(), updatedAt: Date.now(), rev: 1 });
    else if (op.op === "assign") {
      const task = room.tasks.find(task => task.id === op.task)!;
      task.assignee = assigneeId(room, op.assignee); task.rev++;
    } else if (op.op === "done") room.tasks.find(task => task.id === op.task)!.status = "done";
    else throw new Error(`Unsupported QA task operation ${op.op}`);
  } else throw new Error(`Unexpected member QA command ${command}`);
  persist(); return room;
}
let callback = 0;
Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "qa" }, currentWebview: { label: "qa", windowLabel: "qa" } },
    transformCallback: () => ++callback, unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      const call: (typeof qa.calls)[number] = { command, args: structuredClone(args) }; qa.calls.push(call);
      try {
        if (qa.failNext === command) { qa.failNext = ""; throw new Error("Isolated save failure"); }
        const result = structuredClone(dispatch(command, args)); call.result = result; return result;
      } catch (error) { call.error = String(error); throw error; }
    },
  },
});

const tab = (id: string, kind: AgentKind = "codex") => ({ id, kind, phase: "running", activity: "idle", title: id, agentName: id, project }) as WorkspaceTab;
const { RoomView } = await import("../../../rooms/view/RoomView");
function Fixture() {
  const [visible, show] = useState(true);
  const [tabs, setTabs] = useState(() => [...rooms.values()].flatMap(room => room.members.map(member => tab(member.tabId)))
    .concat([tab("available-codex-a"), tab("available-codex-b"), tab("available-claude", "claude")]));
  qa.show = show;
  return <ThemeProvider><div className="app-shell is-rooms" style={{ display: "grid", height: "100vh" }}>
    {visible ? <RoomView project={project} tabs={tabs} onClose={() => show(false)}
      agents={(["codex", "claude"] as const).map(kind => ({ descriptor: agentDescriptor(kind), kind,
        available: true, executable: `/qa/${kind}`, version: null, reason: null }))}
      onLaunchMember={async (kind, root) => {
        const tabId = `launched-${qa.launches.length}`; qa.launches.push({ kind, root, tabId });
        setTabs(current => [...current, tab(tabId, kind)]); return tabId;
      }} onRenameAgent={(tabId, title) => { qa.renames.push({ tabId, title }); return null; }} /> : null}
  </div></ThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
