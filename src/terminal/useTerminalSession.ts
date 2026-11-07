import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useBackground } from "../background/BackgroundProvider";
import { useTheme } from "../theme/ThemeProvider";
import { xtermTheme } from "../theme/xtermTheme";
import { useTypography } from "../typography/TypographyProvider";
import { closeTerminal, closeTerminalTab } from "./api";
import {
  type SessionActivity,
  type TerminalCommandTarget,
  type TerminalLaunch,
  type TerminalPhase,
  type TerminalSession,
} from "./contracts";
import { errorMessage, mountTerminal, type TerminalHandle } from "./terminalController";
import type { TerminalSearchController } from "./search";
import type { HookSnapshot } from "../agent/hooks/contracts";
import type { AgentSessionRef } from "../agent/contracts";
import { isMissingTerminalSession, isRetryableTerminalConnectionError } from "./controller/diagnostics";
import { initialResumeSessionId, matchingSessionId, RECONNECT_DELAYS_MS, RECONNECT_STABLE_MS, sameTerminalTarget, sessionRefForLaunch } from "./sessionRecovery";

interface TerminalViewModel {
  daemonSessionId?: string | null;
  canReconnect: boolean;
  reconnect: () => void;
  phase: TerminalPhase;
  error: string | null;
  shell: string;
  cols: number;
  rows: number;
  /** 用户最近提交的一行原始输入，未做任何提炼。 */
  lastInput: string | null;
  /** 会话在生成 / 等按键 / 闲着。Shell 会话恒为 idle。 */
  activity: SessionActivity;
  agentState: HookSnapshot | null;
  agentSessionRef: AgentSessionRef | null;
  search: TerminalSearchController | null;
  commandTarget: TerminalCommandTarget;
  restart: () => void;
  close: () => void;
  dismissError: () => void;
}

export function useTerminalSession(
  container: RefObject<HTMLDivElement | null>,
  launch: TerminalLaunch = {
    profileId: "system-default",
    cwd: null,
    tabId: null,
    collaborationMode: false,
    resumeSessionId: null,
    ssh: null,
  },
  onSearchRequest?: () => void,
  onOpenFile?: (path: string, line: number | null) => void,
  onOutput?: (text: string) => void,
): TerminalViewModel {
  const { mode } = useTheme();
  const { runtime: typography } = useTypography();
  // 有图可铺时终端才让底色透出去；图还没加载完就照旧不透明，避免中间闪一下画布色。
  const { url } = useBackground();
  const transparent = url !== null;
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [lastInput, setLastInput] = useState<string | null>(null);
  const [activity, setActivity] = useState<SessionActivity>("idle");
  const [agentState, setAgentState] = useState<HookSnapshot | null>(null);
  const [search, setSearch] = useState<TerminalSearchController | null>(null);
  const sessionId = useRef<string | null>(null);
  const attachment = useRef(launch.attachmentId ?? null);
  const target = useRef(launch);
  const identityTarget = useRef(launch);
  const nativeResume = useRef(initialResumeSessionId(launch));
  const [nativeIdentity, setNativeIdentity] = useState({ target: launch, session: sessionRefForLaunch(launch, nativeResume.current) });
  const mountReason = useRef<"launch" | "restore" | "restart" | "reconnect">(launch.attachmentId ? "restore" : "launch");
  const reconnectAttempts = useRef(0);
  const actions = useRef<{ restart: () => void; reconnect: () => void; close: () => void } | null>(null);
  const handle = useRef<TerminalHandle | null>(null);
  // 主题、背景和字体都不能进挂载 effect 的依赖，否则设置外观会重挂终端、连带杀掉 PTY 会话。
  const themeMode = useRef(mode);
  const transparentMode = useRef(transparent);
  const typographyConfig = useRef(typography);
  const searchRequest = useRef(onSearchRequest);
  searchRequest.current = onSearchRequest;
  const fileRequest = useRef(onOpenFile);
  fileRequest.current = onOpenFile;
  const outputRequest = useRef(onOutput);
  outputRequest.current = onOutput;

  const publishIdentity = (scope: TerminalLaunch) => {
    const session = sessionRefForLaunch(scope, nativeResume.current);
    setNativeIdentity((current) => sameTerminalTarget(current.target, scope) && current.session?.id === session?.id
      ? current : { target: scope, session });
  };

  // 工作区的实时身份只更新这个引用，不参与下面的挂载 effect。
  // 只在传入身份改变时同步，避免本地刚收到新 Hook 又被上一帧的旧 prop 覆盖。
  useEffect(() => {
    if (!sameTerminalTarget(identityTarget.current, launch)
      || identityTarget.current.resumeSessionId !== launch.resumeSessionId) {
      nativeResume.current = initialResumeSessionId(launch);
    } else {
      nativeResume.current = matchingSessionId(launch, launch.agentSessionRef) ?? nativeResume.current;
    }
    identityTarget.current = launch;
    publishIdentity(launch);
  }, [launch.tabId, launch.profileId, launch.cwd, launch.ssh, launch.resumeSessionId,
    launch.agentSessionRef?.agent, launch.agentSessionRef?.id]);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let active = true;
    let stopping = false;
    let allowRetry = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelTimers = () => { clearTimeout(retryTimer); clearTimeout(stableTimer); retryTimer = stableTimer = undefined; };
    const guard = <T,>(write: (value: T) => void) => (value: T) => { if (active) write(value); };
    // 换了一条会话（tabId 变了）就必须换接驳身份：沿用上一条的 attachment 会让
    // 新标签带着旧身份去接驳，守护进程按标签 / 项目校验时整条拒绝。
    if (!sameTerminalTarget(target.current, launch)) {
      attachment.current = launch.attachmentId ?? null;
      sessionId.current = null;
      setSession(null); setAgentState(null); setLastInput(null);
      reconnectAttempts.current = 0;
      mountReason.current = launch.attachmentId ? "restore" : "launch";
    }
    target.current = launch;
    const resume = () => nativeResume.current ?? initialResumeSessionId(launch);
    const reconnectNow = () => {
      if (!active || stopping || !attachment.current) return;
      cancelTimers();
      mountReason.current = "reconnect";
      setError(null);
      setGeneration((value) => value + 1);
    };
    const recovering = mountReason.current === "restore" || mountReason.current === "reconnect";
    const mounted = mountTerminal(
      host,
      { ...launch, attachmentId: attachment.current, resumeSessionId: resume(),
        recoverExited: recovering && !!attachment.current,
        skipStartup: mountReason.current !== "launch" || !!attachment.current },
      xtermTheme(themeMode.current),
      transparentMode.current,
      typographyConfig.current,
      {
        onPhase: (value) => {
          if (!active) return;
          setPhase(value);
          clearTimeout(stableTimer);
          // 连接刚返回就再次断开不算恢复成功，避免抖动连接无限重试。
          if (value === "running" && allowRetry && reconnectAttempts.current > 0) {
            stableTimer = setTimeout(() => { if (active) reconnectAttempts.current = 0; }, RECONNECT_STABLE_MS);
          }
        },
        onError: guard(setError),
        getResumeSessionId: resume,
        onSessionIdentity: (value) => {
          if (!active) return;
          nativeResume.current = matchingSessionId(launch, value) ?? nativeResume.current;
          publishIdentity(launch);
        },
        onConnectionFailure: (failure, failedAttachment) => {
          if (!active || stopping || !allowRetry) return;
          cancelTimers();
          if (failedAttachment) attachment.current = failedAttachment;
          if (!attachment.current || !isRetryableTerminalConnectionError(failure)) return;
          const delay = RECONNECT_DELAYS_MS[reconnectAttempts.current];
          if (delay === undefined) return;
          reconnectAttempts.current += 1;
          retryTimer = setTimeout(reconnectNow, delay);
        },
        onAttachmentLost: () => {
          if (!active) return;
          attachment.current = null; sessionId.current = null;
          setSession(null); setAgentState(null);
        },
        onSession: (value) => {
          if (!active) return;
          if (value) { sessionId.current = value.id; attachment.current = value.id; setSession(value); }
        },
        onInput: guard(setLastInput),
        onActivity: guard(setActivity),
        onAgentState: guard(setAgentState),
        onOpenFile: (path, line) => fileRequest.current?.(path, line),
        onOutput: (text) => outputRequest.current?.(text),
        onSearchRequest: () => searchRequest.current?.(),
      },
    );
    handle.current = mounted;
    setSearch(mounted.search);
    actions.current = {
      restart: () => {
        if (!active || stopping) return;
        stopping = true;
        cancelTimers();
        const stop = launch.tabId ? closeTerminalTab(launch.tabId)
          : sessionId.current ? closeTerminal(sessionId.current) : Promise.resolve();
        void stop.then(() => {
          if (!active) return;
          attachment.current = null; sessionId.current = null;
          setSession(null); setAgentState(null); setError(null);
          reconnectAttempts.current = 0;
          mountReason.current = "restart";
          setGeneration((value) => value + 1);
        }).catch((failure) => {
          if (!active) return;
          stopping = false;
          setError(errorMessage(failure));
        });
      },
      reconnect: () => { reconnectAttempts.current = 0; reconnectNow(); },
      close: () => {
        cancelTimers();
        allowRetry = false;
        const current = sessionId.current;
        if (current) void closeTerminal(current).catch(guard((failure: unknown) => setError(errorMessage(failure))));
      },
    };
    return () => {
      active = false;
      cancelTimers();
      actions.current = null;
      handle.current = null;
      setSearch(null);
      mounted.dispose();
    };
  }, [container, generation, launch.tabId, launch.collaborationMode, launch.cwd, launch.profileId,
    launch.resumeSessionId, launch.ssh, launch.projectLaunch, launch.attachmentId]);

  useEffect(() => {
    themeMode.current = mode;
    transparentMode.current = transparent;
    handle.current?.applyTheme(xtermTheme(mode), transparent);
  }, [mode, transparent]);

  useEffect(() => {
    typographyConfig.current = typography;
    handle.current?.applyTypography(typography);
  }, [typography]);

  const restart = useCallback(() => actions.current?.restart(), []);
  const reconnect = useCallback(() => actions.current?.reconnect(), []);
  const focus = useCallback(() => handle.current?.focus(), []);
  const sendText = useCallback<TerminalCommandTarget["sendText"]>((text, options) => handle.current?.sendText(text, options) ?? false, []);
  const commandTarget = useMemo(() => ({ focus, sendText, notifyInputIssue: setError,
    getSessionId: () => sessionId.current }),
  [focus, sendText, generation, launch.tabId, launch.collaborationMode, launch.cwd, launch.profileId,
    launch.resumeSessionId, launch.ssh, launch.projectLaunch, launch.attachmentId]);
  const close = useCallback(() => actions.current?.close(), []);

  return {
    daemonSessionId: session?.id ?? attachment.current ?? null,
    canReconnect: phase === "error" && !!attachment.current && !isMissingTerminalSession(error),
    reconnect,
    phase,
    error,
    shell: session?.shell ?? "system-default",
    cols: session?.cols ?? 0,
    rows: session?.rows ?? 0,
    lastInput,
    activity,
    agentState,
    agentSessionRef: sameTerminalTarget(nativeIdentity.target, launch) ? nativeIdentity.session
      : sessionRefForLaunch(launch, initialResumeSessionId(launch)),
    search,
    commandTarget,
    restart,
    close,
    dismissError: () => setError(null),
  };
}
