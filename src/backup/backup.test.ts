import { describe, expect, it } from "vitest";
import { createBackup, parseBackup } from "./package";
import { applyPendingBackup, backupStatus, cancelPendingBackup, scheduleRestore, scheduleUndo } from "./transaction";
import { BACKUP_PENDING_KEY, BACKUP_TRANSACTION_KEY, BACKUP_UNDO_KEY } from "./contracts";
import { WORKSPACE_STATE_KEY } from "../workspace/storage";
import { THEME_MODE_KEY } from "../theme/storage";
import { BACKGROUND_KEY } from "../background/storage";
import { NAMED_WORKSPACES_KEY } from "../workspace/named/contracts";

class MemoryStorage {
  data = new Map<string, string>();
  failKey: string | null = null;
  failOnce = false;
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (key === this.failKey) {
      if (this.failOnce) this.failKey = null;
      throw new Error("磁盘配额不足");
    }
    this.data.set(key, value);
  }
  removeItem(key: string) { this.data.delete(key); }
}

function source() {
  const storage = new MemoryStorage();
  storage.setItem(THEME_MODE_KEY, "light");
  storage.setItem(WORKSPACE_STATE_KEY, JSON.stringify({ tabs: [{
    id: "qa-tab", kind: "ssh", title: "terminal output with secret", titleHint: "api-key hidden",
    project: { id: "qa-project", name: "中文 项目", rootPath: "/tmp/中文 项目", rootUri: "file:///tmp/project", apiKey: "do-not-export" },
    profileId: "ssh", sshTarget: { host: "qa-alias", user: null, port: null, remotePath: "/QA 项目/John's folder", password: "do-not-export" },
    projectLaunch: { startupCommand: "export API_KEY=secret", env: { API_KEY: "secret" } },
  }], activeTabId: "qa-tab" }));
  return storage;
}

describe("本地备份包", () => {
  it("仅导出稳定目标，排除凭据、终端内容与启动配置，保留中文远端路径", () => {
    const backup = createBackup(source());
    const raw = JSON.stringify(backup);
    for (const secret of ["do-not-export", "API_KEY", "terminal output", "api-key hidden", "startupCommand", "password"]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain("/QA 项目/John's folder");
    expect(raw).toContain("中文 项目");
    expect(parseBackup(raw)).toEqual(backup);
  });

  it("拒绝损坏、新版本、伪造数据域和丢失会话引用", () => {
    expect(() => parseBackup("{" )).toThrow();
    const backup = createBackup(source());
    expect(() => parseBackup(JSON.stringify({ ...backup, version: 99 }))).toThrow(/版本/);
    expect(() => parseBackup(JSON.stringify({ ...backup, domains: { provider: {} } }))).toThrow(/数据域/);
    const invalid = structuredClone(backup);
    invalid.domains.workspace!.groups.workspaces[0].tabIds.push("missing");
    expect(() => parseBackup(JSON.stringify(invalid))).toThrow(/会话/);
  });
});

describe("恢复事务", () => {
  it("排队不改变当前配置，启动只恢复选中域，撤回回到恢复前状态", () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_MODE_KEY, "dark");
    storage.setItem(WORKSPACE_STATE_KEY, "original workspace bytes");
    storage.setItem(BACKGROUND_KEY, JSON.stringify({ fileName: "local.webp", mime: "image/webp" }));
    scheduleRestore({ backup: createBackup(source()), domains: ["appearance"] }, storage);
    expect(storage.getItem(THEME_MODE_KEY)).toBe("dark");
    expect(applyPendingBackup(storage).error).toBeNull();
    expect(storage.getItem(THEME_MODE_KEY)).toBe("light");
    expect(storage.getItem(WORKSPACE_STATE_KEY)).toBe("original workspace bytes");
    expect(JSON.parse(storage.getItem(BACKGROUND_KEY)!).fileName).toBe("local.webp");
    expect(storage.getItem(BACKUP_UNDO_KEY)).not.toBeNull();
    scheduleUndo(storage);
    applyPendingBackup(storage);
    expect(storage.getItem(THEME_MODE_KEY)).toBe("dark");
    expect(storage.getItem(WORKSPACE_STATE_KEY)).toBe("original workspace bytes");
    expect(storage.getItem(BACKUP_UNDO_KEY)).toBeNull();
  });

  it("中途保存失败按原字节回滚全部选中键，不宣称成功", () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_MODE_KEY, "dark");
    const before = new Map(storage.data);
    scheduleRestore({ backup: createBackup(source()), domains: ["appearance", "workspace"] }, storage);
    storage.failKey = NAMED_WORKSPACES_KEY; storage.failOnce = true;
    expect(applyPendingBackup(storage).error).toBeNull();
    for (const [key, value] of before) expect(storage.getItem(key)).toBe(value);
    expect(storage.getItem(WORKSPACE_STATE_KEY)).toBeNull();
    expect(storage.getItem(BACKUP_PENDING_KEY)).toBeNull();
    expect(backupStatus(storage).message).toContain("已回滚");
  });

  it("恢复前快照无法保存时不碰任何业务配置，排队可以取消", () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_MODE_KEY, "dark");
    scheduleRestore({ backup: createBackup(source()), domains: ["appearance"] }, storage);
    storage.failKey = BACKUP_TRANSACTION_KEY;
    expect(applyPendingBackup(storage).error).not.toBeNull();
    expect(storage.getItem(THEME_MODE_KEY)).toBe("dark");
    storage.failKey = null;
    cancelPendingBackup(storage);
    expect(storage.getItem(BACKUP_PENDING_KEY)).toBeNull();
  });

  it("未完成事务下次启动先回滚，不重复应用导入", () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_MODE_KEY, "light");
    storage.setItem(BACKUP_TRANSACTION_KEY, JSON.stringify({ version: 1, id: "qa", mode: "restore",
      before: { [THEME_MODE_KEY]: "dark" }, after: { [THEME_MODE_KEY]: "light" }, previousUndo: null }));
    expect(applyPendingBackup(storage).error).toBeNull();
    expect(storage.getItem(THEME_MODE_KEY)).toBe("dark");
    expect(backupStatus(storage).message).toContain("已回滚");
  });

  it("事务不能写入任意存储键，重复排队与无选择会被拒绝", () => {
    const storage = new MemoryStorage();
    const backup = createBackup(source());
    expect(() => scheduleRestore({ backup, domains: [] }, storage)).toThrow();
    scheduleRestore({ backup, domains: ["workspace"] }, storage);
    expect(() => scheduleRestore({ backup, domains: ["appearance"] }, storage)).toThrow(/已有/);
    storage.setItem(BACKUP_TRANSACTION_KEY, JSON.stringify({ version: 1, id: "bad", mode: "restore",
      before: { "provider-secrets": "overwrite" }, after: {}, previousUndo: null }));
    expect(applyPendingBackup(storage).error).not.toBeNull();
    expect(storage.getItem("provider-secrets")).toBeNull();
  });

  it("回滚也失败时留下事务并阻止启动，下次恢复后不会丢原配置", () => {
    const storage = new MemoryStorage();
    storage.setItem(THEME_MODE_KEY, "dark");
    scheduleRestore({ backup: createBackup(source()), domains: ["appearance"] }, storage);
    storage.failKey = THEME_MODE_KEY;
    expect(applyPendingBackup(storage).error).not.toBeNull();
    expect(storage.getItem(BACKUP_TRANSACTION_KEY)).not.toBeNull();
    storage.failKey = null;
    expect(applyPendingBackup(storage).error).toBeNull();
    expect(storage.getItem(THEME_MODE_KEY)).toBe("dark");
    expect(storage.getItem(BACKUP_TRANSACTION_KEY)).toBeNull();
  });

  it("撤回快照包含排队之后、退出之前的最新配置", () => {
    const storage = new MemoryStorage();
    scheduleRestore({ backup: createBackup(source()), domains: ["appearance"] }, storage);
    storage.setItem(THEME_MODE_KEY, "dark");
    applyPendingBackup(storage); scheduleUndo(storage); applyPendingBackup(storage);
    expect(storage.getItem(THEME_MODE_KEY)).toBe("dark");
  });
});
