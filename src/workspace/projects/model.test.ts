import { describe, expect, it } from "vitest";
import { rememberProject } from "../storage";
import type { ProjectWorkspace } from "../contracts";
import { createProfile, findProfile, parseCatalog, updateProfile } from "./model";
import { parseEnvironment } from "./environment";
import type { ProjectCatalog } from "./contracts";

export const project = (rootPath = "/work/中文 项目"): ProjectWorkspace => ({
  id: rootPath, name: rootPath.split("/").at(-1) ?? "项目", rootPath, rootUri: `file://${rootPath}`,
});
const empty = (): ProjectCatalog => ({ version: 1, entries: [] });

describe("project catalog", () => {
  it("keeps more than six favorites independently of recent eviction", () => {
    let catalog = empty();
    let recent: ReturnType<typeof rememberProject> = [];
    for (let index = 0; index < 12; index++) {
      const workspace = project(`/work/${index}`);
      const entry = { ...createProfile(workspace), favorite: true };
      catalog = updateProfile(catalog, entry);
      recent = rememberProject(workspace, recent);
    }
    expect(catalog.entries).toHaveLength(12);
    expect(recent).toHaveLength(6);
    expect(parseCatalog(JSON.stringify(catalog)).entries).toHaveLength(12);
  });

  it("repairs paths without losing the favorite, group or startup configuration", () => {
    const original = { ...createProfile(project()), favorite: true, group: "工作", command: "pnpm dev", env: { MODE: "中文 value" } };
    const catalog = updateProfile(empty(), original);
    const next = { ...original, project: project("/work/移动后 项目") };
    const repaired = updateProfile(catalog, next);
    expect(repaired.entries).toEqual([next]);
    expect(findProfile(repaired, original.project.rootPath)).toBeUndefined();
  });

  it("rejects collisions after normalizing Windows paths", () => {
    const first = createProfile(project("C:\\Work\\Demo"));
    const next = createProfile(project("c:/work/demo/"));
    const catalog = updateProfile(empty(), first);
    expect(findProfile(catalog, next.project.rootPath)?.id).toBe(first.id);
    expect(() => updateProfile(catalog, next)).toThrow(/已保存/);
  });

  it("rejects unknown versions and invalid records instead of silently losing profiles", () => {
    expect(() => parseCatalog('{"version":2,"entries":[]}')).toThrow(/版本/);
    expect(() => parseCatalog('{"version":1,"entries":[{}]}')).toThrow();
    const entry = { ...createProfile(project()), env: { OPENAI_API_KEY: "secret" } };
    expect(() => updateProfile(empty(), entry)).toThrow(/敏感|凭据/);
  });
});

describe("non-sensitive project environment", () => {
  it("preserves Chinese, spaces and equals literally without shell expansion", () => {
    expect(parseEnvironment("MODE=中文 value\nPROJECT_PATH=/work/带 空格\nEXPR=a=b\nEMPTY="))
      .toEqual({ MODE: "中文 value", PROJECT_PATH: "/work/带 空格", EXPR: "a=b", EMPTY: "" });
  });
  it("rejects credentials, private keys, reserved identities and duplicates", () => {
    for (const input of ["API_KEY=secret", "AUTH_TOKEN=x", "PASSWORD=x", "BELFRY_TAB_ID=x", "CODEX_HOME=/tmp",
      "CLAUDE_CONFIG_DIR=/tmp", "HOME=/tmp", "__proto__=x", "X=-----BEGIN OPENSSH PRIVATE KEY-----", "A=x\nA=y"]) {
      expect(() => parseEnvironment(input), input).toThrow();
    }
  });
  it("bounds input and rejects control characters or malformed names", () => {
    for (const input of ["NO_SEPARATOR", "A-B=x", "X=a\u0000b", `X=${"x".repeat(2049)}`,
      Array.from({ length: 33 }, (_, index) => `VALUE_${index}=x`).join("\n")]) {
      expect(() => parseEnvironment(input)).toThrow();
    }
  });
  it("rejects case-insensitive duplicate environment names in stored profiles", () => {
    const entry = { ...createProfile(project()), env: { MODE: "one", Mode: "two" } };
    expect(() => updateProfile(empty(), entry)).toThrow(/重复/);
  });
});
