import { invoke } from "@tauri-apps/api/core";
import type { EnvironmentReport } from "./contracts";

export function diagnoseEnvironment() {
  return invoke<EnvironmentReport>("setup_diagnose");
}
