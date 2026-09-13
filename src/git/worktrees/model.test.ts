import { expect, it } from "vitest";
import { mergeTargets, suggestBranch } from "./model";
import type { ManagedWorktree } from "./contracts";

it("按任务名给出不含空白和路径穿越的分支建议，保留中文", () => {
  expect(suggestBranch(" 中文 新功能 ")).toBe("belfry/中文-新功能");
  expect(suggestBranch("../../hello world")).toBe("belfry/hello-world");
  expect(suggestBranch("   ")).toBe("");
});
it("合并选项排除本分支、锁定与游离工作树", () => {
  const tree = { branch: "task/a" } as ManagedWorktree;
  const row = (branch: string | null, locked = false) => ({ rootPath: branch ?? "detached", head: "head", branch, locked });
  expect(mergeTargets(tree, [row("task/a"), row(null), row("busy", true), row("main")])).toEqual([row("main")]);
});
