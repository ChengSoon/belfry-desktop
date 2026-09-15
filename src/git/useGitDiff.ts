import { useEffect, useState } from "react";
import { toAppFailure } from "../workspace/errors";
import { readGitDiff } from "./api";
import type { DiffRequest, GitDiff } from "./contracts";

interface State { key: string; diff: GitDiff | null; loading: boolean; failure: string | null }

export function useGitDiff(request: DiffRequest | null) {
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([request, revision]);
  const [state, setState] = useState<State>({ key, diff: null, loading: false, failure: null });
  useEffect(() => {
    let active = true;
    setState({ key, diff: null, loading: Boolean(request), failure: null });
    if (!request) return;
    void readGitDiff(request).then((diff) => {
      if (active) setState({ key, diff, loading: false, failure: null });
    }).catch((error) => {
      if (active) setState({ key, diff: null, loading: false, failure: toAppFailure(error).message });
    });
    return () => { active = false; };
  }, [key]);
  const current = state.key === key ? state : { key, diff: null, loading: Boolean(request), failure: null };
  return { ...current, reload: () => setRevision((current) => current + 1) };
}
