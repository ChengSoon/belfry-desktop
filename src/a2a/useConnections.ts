import { useCallback, useEffect, useRef, useState } from "react";
import { t, useFeedback } from "../i18n";
import { isProbeCancelled, listConnections, probeConnection, removeConnection, saveConnection } from "./api";
import type { ConnectionDraft, ConnectionInfo, Discovery } from "./contracts";
import { changeConnectionForm, connectionDraft, editConnectionForm, newConnectionForm, validateConnectionForm, type ConnectionForm, type FormIssue } from "./model";
import { a2aErrorMessage } from "./feedback";

interface Editor { form: ConnectionForm; original: ConnectionInfo | null }
type Busy = "probe" | "save" | "remove" | null;

export function useConnections(rootPath: string, onGuardChange: (guarded: boolean) => void) {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<ConnectionInfo | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [issue, setIssue] = useState<FormIssue | null>(null);
  const [failure, setFailure] = useFeedback<string | null>(null);
  const [notice, setNotice] = useFeedback<string | null>(null);
  const alive = useRef(true), loadSequence = useRef(0), operationSequence = useRef(0);
  const probe = useRef<AbortController | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      loadSequence.current++;
      operationSequence.current++;
      probe.current?.abort();
      onGuardChange(false);
    };
  }, [rootPath, onGuardChange]);

  useEffect(() => { onGuardChange(editor !== null || removing !== null || busy === "save" || busy === "remove"); },
    [editor, removing, busy, onGuardChange]);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setFailure(null);
    try {
      const value = await listConnections(rootPath);
      if (alive.current && sequence === loadSequence.current) setConnections(value.filter(connection => !connection.local && !connection.id.startsWith("local:")));
    } catch (error) { if (alive.current && sequence === loadSequence.current) setFailure(() => a2aErrorMessage(error)); }
    finally { if (alive.current && sequence === loadSequence.current) setLoading(false); }
  }, [rootPath, setFailure]);
  useEffect(() => { void refresh(); }, [refresh]);

  const resetFeedback = () => { setFailure(null); setNotice(null); setIssue(null); setDiscovery(null); };
  const openEditor = (original: ConnectionInfo | null) => {
    resetFeedback(); setRemoving(null);
    setEditor({ original, form: original ? editConnectionForm(original) : newConnectionForm() });
  };
  const closeEditor = () => {
    operationSequence.current++; probe.current?.abort(); probe.current = null;
    setEditor(null); setBusy(null); resetFeedback();
  };
  const change = (patch: Partial<ConnectionForm>) => {
    if (!editor || busy) return;
    setEditor({ ...editor, form: changeConnectionForm(editor.form, patch, editor.original) });
    setIssue(null); setFailure(null); setNotice(null); setDiscovery(null);
  };
  const validDraft = () => {
    if (!editor) return null;
    const problem = validateConnectionForm(editor.form, editor.original);
    setIssue(problem);
    return problem ? null : connectionDraft(editor.form, editor.original);
  };
  const runProbe = async (draft: ConnectionDraft) => {
    const sequence = ++operationSequence.current, controller = new AbortController();
    probe.current = controller;
    setBusy("probe"); setFailure(null); setNotice(null); setDiscovery(null);
    try {
      const value = await probeConnection(rootPath, draft, controller.signal);
      if (alive.current && sequence === operationSequence.current) setDiscovery(value);
    } catch (error) {
      if (alive.current && sequence === operationSequence.current) {
        if (isProbeCancelled(error)) setNotice(() => t("a2a.notice.checkCancelled")); else setFailure(() => a2aErrorMessage(error));
      }
    } finally {
      if (alive.current && sequence === operationSequence.current) { probe.current = null; setBusy(null); }
    }
  };
  const check = async () => {
    if (busy) return;
    const draft = validDraft(); if (draft) await runProbe(draft);
  };
  /** Selecting a Card interface is also a check: the user should not have to
   * click "check" again after an explicit cross-origin/tenant choice. */
  const selectInterface = (interfaceUrl: string, interfaceTenant: string) => {
    if (!editor || busy) return;
    const form = changeConnectionForm(editor.form, { interfaceUrl, interfaceTenant }, editor.original);
    setEditor({ ...editor, form });
    const problem = validateConnectionForm(form, editor.original);
    setIssue(problem);
    setFailure(null); setNotice(null);
    if (!problem) void runProbe(connectionDraft(form, editor.original));
  };
  const save = async () => {
    if (busy) return;
    const draft = validDraft(); if (!draft) return;
    const sequence = ++operationSequence.current;
    setBusy("save"); setFailure(null); setNotice(null);
    try {
      const value = await saveConnection(rootPath, draft);
      if (alive.current && sequence === operationSequence.current) {
        loadSequence.current++;
        setConnections(current => [...current.filter(connection => connection.id !== value.id), value]);
        setLoading(false); setEditor(null); setDiscovery(null); setIssue(null);
        setNotice(() => t("a2a.notice.saved"));
      }
    } catch (error) { if (alive.current && sequence === operationSequence.current) setFailure(() => a2aErrorMessage(error)); }
    finally { if (alive.current && sequence === operationSequence.current) setBusy(null); }
  };
  const confirmRemove = async () => {
    if (!removing || busy) return;
    const connection = removing, sequence = ++operationSequence.current;
    setBusy("remove"); setFailure(null); setNotice(null);
    try {
      await removeConnection(rootPath, connection.id);
      if (alive.current && sequence === operationSequence.current) {
        loadSequence.current++;
        setConnections(current => current.filter(item => item.id !== connection.id)); setLoading(false); setRemoving(null);
        setNotice(() => t("a2a.notice.removed"));
      }
    } catch (error) { if (alive.current && sequence === operationSequence.current) setFailure(() => a2aErrorMessage(error)); }
    finally { if (alive.current && sequence === operationSequence.current) setBusy(null); }
  };

  return { connections, loading, busy, editor, removing, discovery, issue, failure, notice, refresh,
    add: () => openEditor(null), edit: openEditor, closeEditor, change, check, selectInterface, save, cancelCheck: () => probe.current?.abort(),
    requestRemove: (connection: ConnectionInfo) => { resetFeedback(); setRemoving(connection); },
    cancelRemove: () => { setRemoving(null); setFailure(null); }, confirmRemove };
}
