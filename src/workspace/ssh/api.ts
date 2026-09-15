import { invoke } from "@tauri-apps/api/core";
import type { AliasReport, ProbeRequest, RemoteReport } from "./contracts";

export const readAliases = () => invoke<AliasReport>("ssh_aliases");
export const probeSsh = (request: ProbeRequest) => invoke<RemoteReport>("ssh_probe", { request });
export const cancelProbe = (requestId: string) => invoke<void>("ssh_cancel_probe", { requestId });
