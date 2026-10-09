import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";
import { configPreview, configSave } from "../api";
import { EMPTY_DRAFT, toDraft, type ConfigFilePreview, type ProviderDraft } from "../contracts";
import { ProviderForm } from "./ProviderForm";
import { ProviderConfigEditor } from "./ProviderConfigEditor";
import { useProviderEditor } from "./useProviderEditor";

// The existing node-only hook test pattern, with state/effect rerenders for the disclosure lifecycle.
const hooks = vi.hoisted(() => ({
  cursor: 0, slots: [] as unknown[], pending: [] as Array<() => void>, dirty: false,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const memo = <T,>(make: () => T, deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as { deps: unknown[]; value: T } | undefined;
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      hooks.slots[index] = { deps, value: make() };
    }
    return (hooks.slots[index] as { value: T }).value;
  };
  return { ...react,
    useState: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = initial;
      return [hooks.slots[index], (next: T | ((value: T) => T)) => {
        const value = typeof next === "function" ? (next as (value: T) => T)(hooks.slots[index] as T) : next;
        if (!Object.is(value, hooks.slots[index])) hooks.dirty = true;
        hooks.slots[index] = value;
      }];
    },
    useRef: <T,>(initial: T) => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: <T,>(callback: T, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        const slot = { deps, cleanup: previous?.cleanup };
        hooks.slots[index] = slot;
        hooks.pending.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
});
const ports = vi.hoisted(() => ({
  save: vi.fn(), syncLive: vi.fn(), dismissFailure: vi.fn(), dismissNotice: vi.fn(),
  catalog: { agents: [{ kind: "claude", currentId: "saved", providers: [
    { id: "saved", name: "Relay", baseUrl: "https://relay.invalid", hasApiKey: true, model: "", createdAt: 0 },
  ] }], envConflicts: [] },
}));
vi.mock("../useProviders", () => ({ useProviders: () => ports }));
vi.mock("../api", () => ({ configPreview: vi.fn(), configSave: vi.fn() }));
const file: ConfigFilePreview = { path: "/cli/config.json", format: "json", content: "external-cli-secret" };
const guard = vi.fn();
let editor: ReturnType<typeof useProviderEditor>;
function render() {
  let turns = 0;
  do {
    if (++turns > 20) throw new Error("hook render did not settle");
    hooks.cursor = 0; hooks.dirty = false;
    editor = useProviderEditor(guard);
    hooks.pending.splice(0).forEach((effect) => effect());
  } while (hooks.dirty);
}
async function tick() { await vi.advanceTimersByTimeAsync(200); render(); }
function open() { editor.openDraft(toDraft(ports.catalog.agents[0].providers[0])); render(); }
function reveal() {
  const tree = ProviderConfigEditor({
    kind: editor.kind, draft: editor.draft!, hasApiKey: editor.hasApiKey,
    revealSecrets: editor.revealSecrets, onRevealSecrets: editor.enableSensitivePreview,
    files: editor.configFiles, loading: editor.configLoading, failure: editor.configFailure,
    edits: editor.edits, dirtyPaths: editor.dirtyPaths, savingPath: editor.savingPath,
    saveFailure: editor.saveFailure, savedPath: editor.savedPath, copiedPath: editor.copiedPath,
    onReload: vi.fn(), onChange: vi.fn(), onCopy: editor.copyConfig,
    onSave: editor.saveConfigFile, onRevert: editor.revertConfigFile,
  });
  function findButton(node: ReactNode): (() => void) | undefined {
    for (const child of Children.toArray(node)) {
      if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) continue;
      if (child.type === "button" && child.props.children === "查看含密钥的原始配置") return child.props.onClick;
      const found = findButton(child.props.children);
      if (found) return found;
    }
  }
  const click = findButton(tree);
  expect(click).toBeTypeOf("function");
  click!();
  render();
}
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.pending = []; hooks.dirty = false;
  vi.resetAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.mocked(configPreview).mockResolvedValue([file]);
  vi.mocked(configSave).mockResolvedValue(undefined);
  ports.save.mockResolvedValue(ports.catalog); ports.syncLive.mockResolvedValue(ports.catalog);
  render();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("opening and editing never fetches raw config; explicit opt-in enables live previews", async () => {
  open();
  expect(editor.hasApiKey).toBe(true);
  expect(editor.draft?.apiKey).toBe("");
  expect(editor.draft?.apiKeyAction).toBe("keep");
  expect(guard).toHaveBeenLastCalledWith(true);
  editor.setDraft({ ...editor.draft!, name: "Renamed" }); render();
  editor.loadConfig("claude", editor.draft!);
  await tick();
  expect(configPreview).not.toHaveBeenCalled();
  reveal(); await tick();
  expect(configPreview).toHaveBeenLastCalledWith("claude", editor.draft, true);
  expect(editor.configFiles).toEqual([file]);
  editor.setDraft({ ...editor.draft!, model: "new-model" }); render(); await tick();
  expect(configPreview).toHaveBeenCalledTimes(2);
  expect(configPreview).toHaveBeenLastCalledWith("claude", editor.draft, true);
});

it("closing clears content, edits and errors and requires another explicit opt-in", async () => {
  open(); reveal(); await tick();
  editor.setEdits(() => ({ [file.path]: "edited-secret" })); render();
  vi.mocked(configSave).mockRejectedValueOnce(new Error("raw-save-error"));
  await editor.saveConfigFile(file); render();
  expect(editor.saveFailure).toContain("raw-save-error");
  editor.closeDraft(); render();
  expect(editor.revealSecrets).toBe(false);
  expect(editor.configFiles).toBeNull();
  expect(editor.edits).toEqual({});
  expect(editor.configFailure).toBeNull();
  expect(editor.saveFailure).toBeNull();
  expect(guard).toHaveBeenLastCalledWith(false);
  open(); await tick();
  expect(configPreview).toHaveBeenCalledTimes(1);
});

it("switching provider or agent resets consent, and stale raw responses are discarded", async () => {
  let resolve!: (files: ConfigFilePreview[]) => void;
  vi.mocked(configPreview).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  open(); reveal(); await tick();
  editor.openDraft({ ...EMPTY_DRAFT, name: "Other" }); render();
  resolve([file]); await tick();
  expect(editor.configFiles).toBeNull();
  expect(editor.revealSecrets).toBe(false);
  reveal(); await tick();
  expect(editor.configFiles).toEqual([file]);
  editor.setKind("codex"); render(); await tick();
  expect(editor.kind).toBe("codex");
  expect(editor.configFiles).toBeNull();
  expect(editor.revealSecrets).toBe(false);
  expect(editor.draft).toBeNull();
});

it("stale preview errors cannot repopulate a closed editor", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(configPreview).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  open(); reveal(); await tick();
  editor.closeDraft(); render();
  reject(new Error("raw-preview-error")); await tick();
  expect(editor.configFailure).toBeNull();
  expect(editor.configLoading).toBe(false);
});

it("raw edits retain the unsaved guard and block form save until reverted", async () => {
  open(); reveal(); await tick();
  editor.setEdits(() => ({ [file.path]: "unsaved-secret" })); render();
  editor.setDraft({ ...editor.draft!, model: "new-model" }); render(); await tick();
  expect(editor.edits[file.path]).toBe("unsaved-secret");
  expect(editor.dirtyPaths.has(file.path)).toBe(true);
  editor.submit(); render();
  expect(ports.save).not.toHaveBeenCalled();
  expect(editor.formNotice).toContain("未保存");
  editor.revertConfigFile(file.path); render(); await tick();
  editor.submit(); await tick();
  expect(ports.save).toHaveBeenCalledWith("claude", expect.objectContaining({ apiKey: "", apiKeyAction: "keep", model: "new-model" }));
  expect(editor.draft).toBeNull();
  expect(editor.revealSecrets).toBe(false);
});

it("saving raw configuration resyncs the form as empty keep, never as raw or masked key", async () => {
  open(); reveal(); await tick();
  editor.setEdits(() => ({ [file.path]: "updated-raw-secret" })); render();
  await editor.saveConfigFile(file); render();
  expect(configSave).toHaveBeenCalledWith("claude", file.path, "updated-raw-secret");
  expect(ports.syncLive).toHaveBeenCalledWith("claude");
  expect(editor.draft?.apiKey).toBe("");
  expect(editor.draft?.apiKeyAction).toBe("keep");
});

it("typing selects replace; selecting keep or clear discards newly typed key", () => {
  // Inspect the real form event handlers without adding a browser/DOM dependency.
  function find(node: ReactNode, id: string): { onChange: (event: { target: { value: string } }) => void } | undefined {
    for (const child of Children.toArray(node)) {
      if (!isValidElement<{ id?: string; children?: ReactNode; onChange: (event: { target: { value: string } }) => void }>(child)) continue;
      if (child.props.id === id) return child.props;
      const found = find(child.props.children, id);
      if (found) return found;
    }
  }
  let draft: ProviderDraft = { ...EMPTY_DRAFT, id: "saved", apiKeyAction: "keep" };
  function form() {
    hooks.cursor = 0; hooks.slots = [];
    return ProviderForm({ kind: "claude", busy: false, draft, hasApiKey: true, issue: null,
      onCancel: vi.fn(), onSubmit: vi.fn(), onChange: (next) => { draft = next; } });
  }
  find(form(), "provider-apiKey")!.onChange({ target: { value: "new-key" } });
  expect(draft.apiKeyAction).toBe("replace");
  expect(draft.apiKey).toBe("new-key");
  find(form(), "provider-apiKeyAction")!.onChange({ target: { value: "keep" } });
  expect(draft.apiKeyAction).toBe("keep");
  expect(draft.apiKey).toBe("");
  find(form(), "provider-apiKey")!.onChange({ target: { value: "another-key" } });
  find(form(), "provider-apiKeyAction")!.onChange({ target: { value: "clear" } });
  expect(draft.apiKeyAction).toBe("clear");
  expect(draft.apiKey).toBe("");
});
