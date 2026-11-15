// TEST ONLY: synthetic A2A native commands, with no network or real credentials.
(() => {
  const previous = window.__TAURI_INTERNALS__.invoke;
  const qa = window.__a2aQA = { connections: [], local: { agents: [], unsupported: [] }, localError: null, reports: [], reportError: null, calls: [], credentials: new Map(), pending: new Map(), cancelled: [], next: 0, deferProbe: false, crossOrigin: false, probeError: null };
  function discovery(draft) {
    const url = qa.crossOrigin ? "https://other.synthetic.invalid/a2a" : new URL("/a2a", draft.cardUrl).href;
    const agentInterface = { url, protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: "synthetic-tenant" };
    return { card: { name: "Synthetic A2A reviewer", description: "A controllable test Agent; no real service is contacted.", version: "1.0.0-fixture",
      supportedInterfaces: [agentInterface], capabilities: {}, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"],
      skills: [{ id: "review", name: "Review changes", description: "Returns synthetic review results.", tags: ["review", "test"] }] },
      interfaces: [agentInterface], selectedInterface: qa.crossOrigin && draft.interfaceUrl !== url ? null : agentInterface,
      issue: qa.crossOrigin && draft.interfaceUrl !== url ? { code: "A2A_INTERFACE_SELECTION_REQUIRED", message: "Explicit interface selection required" } : null };
  }
  qa.fulfill = requestId => {
    const pending = qa.pending.get(requestId);
    if (!pending) return false;
    qa.pending.delete(requestId); pending.resolve(discovery(pending.draft)); return true;
  };
  const handlers = {
    a2a_local_task_snapshot: () => {
      if (qa.reportError) throw qa.reportError;
      return { tasks: qa.reports };
    },
    a2a_list_connections: ({ rootPath }) => qa.connections.filter(connection => connection.rootPath === rootPath),
    a2a_list_local_agents: ({ rootPath }) => {
      if (qa.localError) throw qa.localError;
      return { agents: qa.local.agents.filter(agent => agent.rootPath === rootPath), unsupported: qa.local.unsupported };
    },
    a2a_probe_connection: ({ draft, requestId }) => {
      if (qa.probeError) throw qa.probeError;
      if (qa.deferProbe) return new Promise(resolve => qa.pending.set(requestId, { resolve, draft: structuredClone(draft) }));
      return discovery(draft);
    },
    a2a_cancel_request: ({ requestId }) => { qa.cancelled.push(requestId); return qa.pending.has(requestId); },
    a2a_save_connection: ({ rootPath, draft }) => {
      const original = qa.connections.find(connection => connection.id === draft.id && connection.rootPath === rootPath);
      const id = original?.id ?? `synthetic-connection-${++qa.next}`;
      if (draft.auth.credential.action === "replace") qa.credentials.set(id, draft.auth.credential.value);
      if (draft.auth.credential.action === "clear") qa.credentials.delete(id);
      const connection = { id, rootPath, name: draft.name, cardUrl: draft.cardUrl, interfaceUrl: draft.interfaceUrl ?? null,
        interfaceTenant: draft.interfaceTenant ?? null,
        auth: { kind: draft.auth.kind, headerName: draft.auth.headerName ?? null, hasCredential: qa.credentials.has(id) }, revision: `revision-${++qa.next}` };
      qa.connections = [...qa.connections.filter(item => item.id !== id), connection]; return connection;
    },
    a2a_remove_connection: ({ rootPath, connectionId }) => {
      qa.connections = qa.connections.filter(connection => connection.rootPath !== rootPath || connection.id !== connectionId);
      qa.credentials.delete(connectionId); return null;
    },
  };
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (!Object.hasOwn(handlers, command)) return previous(command, args);
    qa.calls.push({ command, args: structuredClone(args) }); window.__productionQA.calls.push({ command, args });
    return structuredClone(await handlers[command](args));
  };
})();
