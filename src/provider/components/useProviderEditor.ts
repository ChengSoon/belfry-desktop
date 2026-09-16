import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentKind } from "../../workspace/contracts";
import { failureLabel, toAppFailure } from "../../workspace/errors";
import { configPreview, configSave } from "../api";
import { type ConfigFilePreview, type ProviderConfig, type ProviderDraft, toDraft } from "../contracts";
import { useProviders } from "../useProviders";
import { type DraftIssue, validateDraft } from "../validate";

export function useProviderEditor(onGuardChange: (guarded: boolean) => void) {
  const providers = useProviders(true);
  const [kind, setKind] = useState<AgentKind>("claude");
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [issue, setIssue] = useState<DraftIssue | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ProviderConfig | null>(null);
  const [configFiles, setConfigFiles] = useState<ConfigFilePreview[] | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configFailure, setConfigFailure] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const configRequest = useRef(0);
  /** 正在编辑的文件原文，按 agent 分开存。
      path → 编辑中的内容。与 configFiles 里的原文不一致才算脏。 */
  const [editsByKind, setEditsByKind] = useState<Record<AgentKind, Record<string, string>>>({
    claude: {},
    codex: {},
  });
  const edits = editsByKind[kind];
  const setEdits = (updater: (current: Record<string, string>) => Record<string, string>) => {
    setEditsByKind((all) => ({ ...all, [kind]: updater(all[kind]) }));
  };
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const dirtyPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const file of configFiles ?? []) {
      const edited = edits[file.path];
      if (edited !== undefined && edited !== file.content) paths.add(file.path);
    }
    return paths;
  }, [configFiles, edits]);
  const hasDirty = dirtyPaths.size > 0;

  // 表单或配置编辑到一半时，一次误触关闭就把改动全丢了，所以让外壳先别响应退出手势。
  useEffect(() => {
    onGuardChange(draft !== null || hasDirty);
    return () => onGuardChange(false);
  }, [draft, hasDirty, onGuardChange]);

  const group = providers.catalog?.agents.find((item) => item.kind === kind);
  const list = useMemo(() => group?.providers ?? [], [group]);

  const conflicts = useMemo(
    () => providers.catalog?.envConflicts.filter((item) => item.kind === kind) ?? [],
    [kind, providers.catalog],
  );

  const submit = () => {
    if (!draft) return;
    if (savingPath !== null) {
      setFormNotice("配置文件正在保存，请稍候再保存 provider 信息。");
      return;
    }
    if (hasDirty) {
      setFormNotice("配置文件还有未保存的修改，请先保存或还原，再保存 provider 信息。");
      return;
    }
    const found = validateDraft(draft, list);
    setIssue(found);
    if (found) return;
    setFormNotice(null);
    void providers.save(kind, draft).then((catalog) => {
      if (catalog) closeDraft();
    });
  };

  const loadConfig = useCallback((agentKind: AgentKind, previewDraft?: ProviderDraft) => {
    const request = ++configRequest.current;
    setConfigLoading(true);
    setConfigFailure(null);
    configPreview(agentKind, previewDraft)
      .then((files) => {
        if (request === configRequest.current) setConfigFiles(files);
      })
      .catch((error) => {
        if (request === configRequest.current) setConfigFailure(failureLabel(toAppFailure(error)));
      })
      .finally(() => {
        if (request === configRequest.current) setConfigLoading(false);
      });
  }, []);

  const clearConfigEditor = () => {
    configRequest.current += 1;
    setConfigFiles(null);
    setConfigLoading(false);
    setConfigFailure(null);
    setSaveFailure(null);
    setCopiedPath(null);
    setSavedPath(null);
    setEditsByKind((all) => ({ ...all, [kind]: {} }));
  };

  const closeDraft = () => {
    setDraft(null);
    setIssue(null);
    setFormNotice(null);
    clearConfigEditor();
  };

  const openDraft = (next: ProviderDraft) => {
    providers.dismissNotice();
    setIssue(null);
    setFormNotice(null);
    setDraft(next);
    clearConfigEditor();
  };

  // 表单是草稿的主来源，输入变化后重新生成高级区域的内存预览。
  const draftPreviewKey = draft ? JSON.stringify(draft) : null;
  useEffect(() => {
    if (!draft) return;
    const previewDraft = { ...draft };
    configRequest.current += 1;
    setConfigFiles(null);
    setConfigLoading(true);
    setConfigFailure(null);
    setSaveFailure(null);
    setSavedPath(null);
    setEditsByKind((all) => ({ ...all, [kind]: {} }));
    const timer = window.setTimeout(() => {
      loadConfig(kind, previewDraft);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draftPreviewKey, kind, loadConfig]);

  const copyConfig = async (file: ConfigFilePreview) => {
    const text = edits[file.path] ?? file.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPath(file.path);
      window.setTimeout(() => {
        setCopiedPath((current) => (current === file.path ? null : current));
      }, 1200);
    } catch {
      // 剪贴板不可用时静默失败，不影响查看。
    }
  };

  const saveConfigFile = async (file: ConfigFilePreview) => {
    const next = edits[file.path];
    if (next === undefined) return;
    setSavingPath(file.path);
    setSaveFailure(null);
    try {
      await configSave(kind, file.path, next);
      // 文件已经改了，把当前生效的 live 配置同步进库，列表才能看到刚配置的 provider。
      const synced = await providers.syncLive(kind);
      if (!synced) {
        throw new Error("配置文件已保存，但 provider 列表同步失败，请重新读取");
      }
      // 直接改原始文件后，当前条目的表单值也要跟着 live 配置走，避免用户
      // 紧接着点「保存 provider」时又把刚改好的 JSON/TOML 覆盖回去。
      const liveGroup = synced.agents.find((item) => item.kind === kind);
      const liveProvider = liveGroup?.providers.find((item) => item.id === liveGroup.currentId);
      if (liveProvider) {
        setDraft(toDraft(liveProvider));
      }
      setConfigFiles(
        (current) =>
          current?.map((item) => (item.path === file.path ? { ...item, content: next } : item)) ??
          null,
      );
      setEdits((current) => {
        const rest = { ...current };
        delete rest[file.path];
        return rest;
      });
      setSavedPath(file.path);
      window.setTimeout(() => {
        setSavedPath((current) => (current === file.path ? null : current));
      }, 1500);
    } catch (error) {
      setSaveFailure(failureLabel(toAppFailure(error)));
    } finally {
      setSavingPath(null);
    }
  };

  const revertConfigFile = (path: string) => {
    setEdits((current) => {
      const rest = { ...current };
      delete rest[path];
      return rest;
    });
    setSaveFailure(null);
  };

  return {
    providers, kind, setKind, draft, issue, setIssue, pendingRemove, setPendingRemove,
    configFiles, configLoading, configFailure, copiedPath, formNotice, edits, setEdits,
    savingPath, saveFailure, savedPath, dirtyPaths, group, list, conflicts, submit,
    loadConfig, closeDraft, openDraft, copyConfig, saveConfigFile, revertConfigFile,
    setDraft, setFormNotice,
  };
}
