import type { AgentKind } from "../../workspace/contracts";
import type { EnvConflict } from "../contracts";

export interface ProjectProviderChoice {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  configured: boolean;
}

export interface ProjectAgentProvider {
  kind: AgentKind;
  providerId: string | null;
  source: "project" | "global";
  effectiveName: string;
  missing: boolean;
  choices: ProjectProviderChoice[];
}

export interface ProjectProviderReport {
  rootPath: string;
  agents: ProjectAgentProvider[];
  envConflicts: EnvConflict[];
}

export interface ProjectProviderSelection { rootPath: string; kind: AgentKind; providerId: string | null }
