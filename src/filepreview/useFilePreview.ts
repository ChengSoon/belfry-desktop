import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectWorkspace } from "../workspace/contracts";
import { listProjectDirectory, readProjectFile } from "./api";
import type { ProjectDirectory, ProjectFilePreview } from "./contracts";
import { parentPath } from "./path";

interface FilePreviewState {
  directory: ProjectDirectory | null;
  directoryPath: string;
  failure: string | null;
  loadingDirectory: boolean;
  loadingFile: boolean;
  preview: ProjectFilePreview | null;
  selectedPath: string | null;
  stale: boolean;
}

export function useFilePreview(project: ProjectWorkspace | null) {
  const [state, setState] = useState<FilePreviewState>(initialState);
  // 目录刷新和文件读取可以并行：各自维护版本号，避免一次刷新把另一项结果误判为过期。
  const directoryRequestVersion = useRef(0);
  const fileRequestVersion = useRef(0);
  const rootPath = project?.rootPath ?? null;

  const loadDirectory = useCallback(async (path: string, preserveSelection = false) => {
    if (!rootPath) return;
    const version = ++directoryRequestVersion.current;
    if (!preserveSelection) {
      fileRequestVersion.current += 1;
      setState((current) => ({
        ...current,
        failure: null,
        loadingDirectory: true,
        loadingFile: false,
        preview: null,
        selectedPath: null,
        stale: false,
      }));
    } else {
      setState((current) => ({ ...current, failure: null, loadingDirectory: true }));
    }
    try {
      const directory = await listProjectDirectory(rootPath, path);
      if (version !== directoryRequestVersion.current) return;
      setState((current) => ({
        ...current,
        directory,
        directoryPath: directory.relativePath,
        failure: null,
        loadingDirectory: false,
        ...(preserveSelection ? {} : { preview: null, selectedPath: null, stale: false }),
      }));
    } catch (error) {
      if (version === directoryRequestVersion.current) {
        setState((current) => ({
          ...current,
          failure: errorMessage(error),
          loadingDirectory: false,
        }));
      }
    }
  }, [rootPath]);

  const openDirectory = useCallback((path: string) => {
    void loadDirectory(path);
  }, [loadDirectory]);

  const openFile = useCallback(async (path: string) => {
    if (!rootPath) return;
    const version = ++fileRequestVersion.current;
    setState((current) => ({
      ...current,
      failure: null,
      loadingFile: true,
      selectedPath: path,
      stale: false,
    }));
    try {
      const preview = await readProjectFile(rootPath, path);
      if (version !== fileRequestVersion.current) return;
      setState((current) => ({ ...current, loadingFile: false, preview, stale: false }));
    } catch (error) {
      if (version === fileRequestVersion.current) {
        setState((current) => ({ ...current, failure: errorMessage(error), loadingFile: false }));
      }
    }
  }, [rootPath]);

  const openPath = useCallback((path: string) => {
    void loadDirectory(parentPath(path), true);
    void openFile(path);
  }, [loadDirectory, openFile]);

  const reloadFile = useCallback(() => {
    if (state.selectedPath) void openFile(state.selectedPath);
  }, [openFile, state.selectedPath]);

  const refresh = useCallback(() => {
    void loadDirectory(state.directoryPath, true);
    if (state.selectedPath) void openFile(state.selectedPath);
  }, [loadDirectory, openFile, state.directoryPath, state.selectedPath]);

  useEffect(() => {
    directoryRequestVersion.current += 1;
    fileRequestVersion.current += 1;
    setState(initialState());
    if (rootPath) void loadDirectory("");
    return () => {
      directoryRequestVersion.current += 1;
      fileRequestVersion.current += 1;
    };
  }, [loadDirectory, rootPath]);

  useEffect(() => {
    if (!rootPath || !state.selectedPath || !state.preview) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void readProjectFile(rootPath, state.selectedPath!).then((next) => {
        if (!cancelled && (
          next.modifiedAt !== state.preview?.modifiedAt || next.size !== state.preview?.size
        )) {
          setState((current) => ({ ...current, stale: true }));
        }
      }).catch(() => undefined);
    }, 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rootPath, state.preview, state.selectedPath]);

  return {
    ...state,
    clearFailure: () => setState((current) => ({ ...current, failure: null })),
    loadDirectory,
    openDirectory,
    openFile,
    openPath,
    refresh,
    reloadFile,
  };
}

function initialState(): FilePreviewState {
  return {
    directory: null,
    directoryPath: "",
    failure: null,
    loadingDirectory: false,
    loadingFile: false,
    preview: null,
    selectedPath: null,
    stale: false,
  };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
