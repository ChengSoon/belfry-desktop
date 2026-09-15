import { useEffect, useRef, useState, type ComponentProps } from "react";
import { FilePreviewPane } from "../filepreview/FilePreviewPane";
import { openProject } from "../workspace/api";
import { toAppFailure } from "../workspace/errors";
import type { ProjectWorkspace } from "../workspace/contracts";
import type { GitFileTarget } from "./contracts";
import { GitPanel } from "./GitPanel";

type Props = Omit<ComponentProps<typeof FilePreviewPane>, "onGit"> & { onOpenProject?: (path: string) => Promise<void> };
interface PreviewTarget { project: ProjectWorkspace; path: string }

export function ProjectInspector(props: Props) {
  const [view, setView] = useState<"files" | "git">("files");
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1; setTarget(null); setFailure(null); setView("files");
    return () => { generation.current += 1; };
  }, [props.project?.rootPath, props.requestedPath, props.requestedLine]);
  const openFile = async (file: GitFileTarget) => {
    const request = ++generation.current;
    setFailure(null);
    try {
      const project = await openProject(file.rootPath);
      if (request !== generation.current) return;
      setTarget({ project, path: file.path }); setView("files");
    } catch (error) { if (request === generation.current) setFailure(toAppFailure(error).message); }
  };
  if (view === "git") return <GitPanel project={props.project} failure={failure} onClose={props.onClose}
    onOpenProject={props.onOpenProject}
    onFiles={() => { generation.current += 1; setView("files"); }} onOpenFile={(file) => void openFile(file)} />;
  return <FilePreviewPane {...props} project={target?.project ?? props.project}
    requestedPath={target?.path ?? props.requestedPath} requestedLine={target ? null : props.requestedLine}
    onGit={() => { setFailure(null); setView("git"); }} />;
}
