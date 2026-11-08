import { t } from "../../i18n";
import type { SshLaunch } from "../../terminal/contracts";
import { cleanTarget } from "./model";
import { message } from "./storage";

export interface SshFields {
  host: string; user: string; port: string; remotePath: string; password: string; remember: boolean;
}

export function parseSshTarget(input: Omit<SshFields, "remotePath"> & { remotePath?: string }): SshLaunch | string {
  if (!input.host.trim()) return t("workspace.target.text_0c6a959b40");
  try {
    const target = cleanTarget(input);
    if (input.password.length > 1_024) return t("workspace.target.text_67f9a4fc26");
    return { ...target, password: input.password || null, rememberPassword: input.remember };
  } catch (error) { return message(error); }
}
