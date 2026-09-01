import { invoke } from "@tauri-apps/api/core";
import type { EnvironmentReport, SkillInstallOutcome } from "./contracts";

export function diagnoseEnvironment() {
  return invoke<EnvironmentReport>("setup_diagnose");
}

export function installBelfrySkill() {
  return invoke<SkillInstallOutcome>("setup_install_skill");
}
