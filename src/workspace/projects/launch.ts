import type { ShellProfileId } from "../../terminal/contracts";
import type { WorkspaceTab } from "../contracts";
import { pathKey } from "../path";
import type { ProjectProfile, StartupIntent } from "./contracts";
import { findProfile } from "./model";
import { loadProjectCatalog, readProjectCatalog } from "./storage";

interface ConfigureOptions { explicit: boolean; shell?: ShellProfileId }
const sent = new WeakSet<StartupIntent>();

export function configureProjectTab(tab: WorkspaceTab, profile: ProjectProfile | undefined, options: ConfigureOptions): WorkspaceTab {
  if (!profile || tab.kind === "ssh" || pathKey(tab.project.rootPath) !== pathKey(profile.project.rootPath)) return tab;
  const shell = tab.kind === "shell";
  const startup = shell && options.explicit && profile.command ? { command: profile.command } : undefined;
  return { ...tab, profileId: shell && options.explicit ? options.shell ?? profile.shell : tab.profileId,
    projectLaunch: { env: { ...profile.env }, ...(startup ? { startup } : {}) } };
}

export function configureNewProjectTab(tab: WorkspaceTab, shell?: ShellProfileId) {
  const catalog = readProjectCatalog();
  return configureProjectTab(tab, findProfile(catalog, tab.project.rootPath), { explicit: true, shell });
}

export function configureRestoredTabs(tabs: WorkspaceTab[]) {
  const { catalog } = loadProjectCatalog();
  return tabs.map((tab) => configureProjectTab(tab, findProfile(catalog, tab.project.rootPath), { explicit: false }));
}

interface StartupOptions {
  intent?: StartupIntent;
  sessionId: string;
  current: () => boolean;
  write: (sessionId: string, bytes: Uint8Array) => Promise<unknown>;
}

/** 过期创建不消费命令；失败也不重试，避免写入成功但确认丢失时执行两次。 */
export async function runStartupOnce({ intent, sessionId, current, write }: StartupOptions) {
  if (!intent?.command || sent.has(intent) || !current()) return;
  sent.add(intent);
  await write(sessionId, new TextEncoder().encode(`${intent.command}\r`));
}
