import { createRoot } from "react-dom/client";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { setLocalePreference } from "../../../i18n";
import { agentDescriptor } from "../../../agent/contracts";
import type { Room, RoomSummary } from "../../../rooms/contracts";
import type { ProjectWorkspace } from "../../../workspace/contracts";
import { resolveLaunchProject } from "../../../workspace/useWorkspaceLaunch";
import "../../../styles.css";

const params = new URLSearchParams(location.search);
setLocalePreference(params.get("locale") === "en" ? "en" : "zh-CN");
const project = (path: string): ProjectWorkspace => ({ id: path, name: path.split(/[\\/]/).at(-1)!, rootPath: path, rootUri: `file://${path}` });
const current = params.has("current") ? project("/qa/current-project") : null;
const rooms = new Map<string, Room>();
const qa = {
  calls: [] as { command: string; args: Record<string, unknown> }[],
  launches: [] as { kind: string; project: ProjectWorkspace }[],
  errors: [] as string[],
  pickerPath: "/qa/linked-project" as string | null,
  resolvedPath: "/qa/other-project",
  projectError: null as string | null,
  holdValidation: false,
  release: () => {},
};
Object.assign(window, { roomCreationQA: qa, qaSetLocale: setLocalePreference });
window.addEventListener("error", event => qa.errors.push(event.message));
window.addEventListener("unhandledrejection", event => qa.errors.push(String(event.reason)));
const summary = (room: Room): RoomSummary => ({
  id: room.id, name: room.name, projectRoot: room.projectRoot, createdAt: room.createdAt,
  objective: room.brief.objective, memberCount: room.members.length,
  memberTabIds: room.members.map(member => member.tabId), memberTitles: room.members.map(member => member.title),
  foreman: room.members[0]?.title ?? null, openTasks: 0, doneTasks: 0, lastMessageAt: null, paused: false, lastToUser: null,
});
let callback = 0;
Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: "qa" }, currentWebview: { label: "qa", windowLabel: "qa" } },
    transformCallback: () => ++callback, unregisterCallback: () => {},
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      qa.calls.push({ command, args });
      if (command === "plugin:dialog|open") return qa.pickerPath;
      if (command === "project_open") {
        if (qa.holdValidation) await new Promise<void>(resolve => { qa.release = resolve; });
        if (qa.projectError) throw new Error(qa.projectError);
        return project(args.path === "/qa/linked-project" ? qa.resolvedPath : String(args.path));
      }
      if (command === "room_list") return { rooms: [...rooms.values()].map(summary), loadError: null };
      if (command === "room_get") return structuredClone(rooms.get(String(args.id)));
      if (command === "room_create") {
        const room: Room = { id: `room-${rooms.size}`, name: String(args.name), projectRoot: String(args.projectRoot), createdAt: Date.now(),
          brief: { objective: String(args.objective), currentFocus: "", constraints: [], updatedBy: null, updatedAt: null },
          members: [], tasks: [], nextTask: 1, messages: [] };
        rooms.set(room.id, room);
        return structuredClone(room);
      }
      if (command === "room_add_member") {
        const room = rooms.get(String(args.id))!;
        room.members.push({ id: String(args.tabId), tabId: String(args.tabId), agent: String(args.agent), title: String(args.title),
          duty: String(args.duty), role: args.foreman ? "foreman" : "peer", joinedAt: Date.now(), leftAt: null });
        return structuredClone(room);
      }
      if (command === "room_clipboard_files") return [];
      if (command === "plugin:event|listen") return ++callback;
      if (command.startsWith("plugin:")) return null;
      throw new Error(`Unexpected room creation IPC: ${command}`);
    },
  },
});

const { RoomView } = await import("../../../rooms/view/RoomView");
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <div className="app-shell is-rooms" style={{ display: "grid", height: "100vh" }}>
      <RoomView project={current} tabs={[]} onClose={() => {}}
        agents={[{ descriptor: agentDescriptor("codex"), kind: "codex", available: true, executable: "/qa/codex", version: null, reason: null }]}
        onLaunchMember={async (kind, projectRoot) => {
          // App.launchRoomMember delegates to this same project resolver without activating the project.
          const target = await resolveLaunchProject(current, { projectRoot, activate: false,
            acceptProject: () => { throw new Error("Room creation must not activate another project"); } });
          qa.launches.push({ kind, project: target });
          return `member-${qa.launches.length}`;
        }} />
    </div>
  </ThemeProvider>,
);
