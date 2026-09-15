import { expect, it } from "vitest";
import { parseWorkspaceState, serializeWorkspaceState } from "../storage";
import { createWorkspaceTab } from "../tabs";

it("重启保留远端目录，不覆盖本地项目且不保存 SSH 密码", () => {
  const project = { id: "local", name: "本机", rootPath: "/local", rootUri: "file:///local" };
  const target = { host: "jump", user: null, port: null, remotePath: "/远程/space folder", password: "private", rememberPassword: true };
  const tab = createWorkspaceTab(project, "ssh", 1, null, target);
  const raw = serializeWorkspaceState([tab], tab.id);
  const restored = parseWorkspaceState(raw)!.tabs[0];
  expect(restored.project).toEqual(project);
  expect(restored.sshTarget?.remotePath).toBe(target.remotePath);
  expect(raw).not.toContain("private");
});
