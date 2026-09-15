import type { ExistingWorktree, ManagedWorktree } from "./contracts";

export function suggestBranch(name: string) {
  const clean = name.normalize("NFKC").trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return clean ? `belfry/${clean}` : "";
}

export function mergeTargets(tree: ManagedWorktree, candidates: ExistingWorktree[]) {
  return candidates.filter((candidate) => !candidate.locked && candidate.branch && candidate.branch !== tree.branch);
}
