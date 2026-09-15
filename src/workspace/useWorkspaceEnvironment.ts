import { useCallback, useRef, useState, type RefObject } from "react";
import { agentDescriptor } from "../agent/contracts";
import { listShellProfiles } from "../terminal/api";
import type { ShellProfile, ShellProfileId } from "../terminal/contracts";
import { detectAgents } from "./api";
import type { AgentAvailability, AgentKind } from "./contracts";
import { toAppFailure } from "./errors";

export function useWorkspaceEnvironment(requestVersion: RefObject<number>) {
  const [agents, setAgents] = useState<AgentAvailability[]>(pendingAgents);
  const [shellProfiles, setShellProfiles] = useState<ShellProfile[]>(pendingShellProfiles);
  const detection = useRef<Promise<AgentAvailability[]> | null>(null);
  const generation = useRef(0);
  const startAgentDetection = useCallback(() => {
    const current = ++generation.current;
    setAgents(pendingAgents());
    const promise = loadAgentState();
    detection.current = promise;
    void promise.then((detected) => {
      if (current === generation.current) setAgents(detected);
    });
    return promise;
  }, []);
  const waitForAgents = useCallback(() => detection.current ?? startAgentDetection(), [startAgentDetection]);
  const refreshShellProfiles = useCallback(async (version: number) => {
    const shells = await loadShellProfileState();
    if (version === requestVersion.current) setShellProfiles(shells);
  }, [requestVersion]);
  const redetectAgents = useCallback(async () => {
    const version = requestVersion.current;
    const agentDetection = startAgentDetection();
    setShellProfiles(pendingShellProfiles());
    await Promise.all([agentDetection, refreshShellProfiles(version)]);
  }, [refreshShellProfiles, requestVersion, startAgentDetection]);
  return { agents, shellProfiles, startAgentDetection, waitForAgents, refreshShellProfiles, redetectAgents };
}

function pendingAgents(): AgentAvailability[] {
  return (["codex", "claude"] as AgentKind[]).map((kind) => ({
    descriptor: agentDescriptor(kind), kind, available: false, executable: null, version: null,
    reason: "正在检测用户命令环境…",
  }));
}

function pendingShellProfiles(): ShellProfile[] {
  const ids: ShellProfileId[] = ["system-default", "shell:zsh", "shell:bash", "shell:fish",
    "shell:pwsh", "shell:powershell", "shell:cmd", "shell:wsl", "shell:git-bash"];
  return ids.map((id) => ({
    id, available: false, executable: null, isDefault: id === "system-default", reason: "正在检测可用 Shell…",
  }));
}

async function loadAgentState() {
  try { return await detectAgents(); }
  catch (error) {
    const reason = toAppFailure(error).message;
    return pendingAgents().map((agent) => ({ ...agent, reason }));
  }
}

async function loadShellProfileState() {
  try { return await listShellProfiles(); }
  catch (error) {
    const reason = toAppFailure(error).message;
    return pendingShellProfiles().map((profile) => ({ ...profile, reason }));
  }
}
