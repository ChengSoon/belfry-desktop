import type { SshLaunch } from "../../terminal/contracts";
import { cleanTarget } from "./model";
import { message } from "./storage";

export interface SshFields {
  host: string; user: string; port: string; remotePath: string; password: string; remember: boolean;
}

export function parseSshTarget(input: Omit<SshFields, "remotePath"> & { remotePath?: string }): SshLaunch | string {
  if (!input.host.trim()) return "主机不能为空";
  try {
    const target = cleanTarget(input);
    if (input.password.length > 1_024) return "密码过长";
    return { ...target, password: input.password || null, rememberPassword: input.remember };
  } catch (error) { return message(error); }
}
