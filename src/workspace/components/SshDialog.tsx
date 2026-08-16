import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { removeSshCredentials } from "../../terminal/api";
import type { SshLaunch, SshTarget } from "../../terminal/contracts";
import { ICON } from "../../theme/sizing";
import { useDismiss } from "../useDismiss";
import "../sshDialog.css";

interface SshDialogProps {
  initialTarget?: SshTarget | null;
  initialRememberPassword?: boolean;
  mode?: "create" | "edit";
  onCancel: () => void;
  onConnect: (target: SshLaunch) => void;
}

export function SshDialog({
  initialTarget,
  initialRememberPassword,
  mode = "create",
  onCancel,
  onConnect,
}: SshDialogProps) {
  const editing = mode === "edit";
  const [host, setHost] = useState(() => initialTarget?.host ?? "");
  const [user, setUser] = useState(() => initialTarget?.user ?? "");
  const [port, setPort] = useState(() => initialTarget?.port?.toString() ?? "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() => initialRememberPassword ?? true);
  const [error, setError] = useState<string | null>(null);
  const [clearState, setClearState] = useState<"idle" | "clearing" | "cleared">("idle");
  const hostRef = useRef<HTMLInputElement>(null);
  const clearTimerRef = useRef<number | null>(null);
  const panelRef = useDismiss<HTMLFormElement>(true, onCancel);

  useEffect(() => {
    hostRef.current?.focus();
    return () => {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const target = parseSshTarget(host, user, port, password, remember);
    if (typeof target === "string") {
      setError(target);
      return;
    }
    onConnect(target);
  };

  const clearSaved = async () => {
    const target = parseSshTarget(host, user, port, "", false);
    if (typeof target === "string") {
      setError(target);
      return;
    }
    setError(null);
    setClearState("clearing");
    try {
      await removeSshCredentials({ host: target.host, user: target.user, port: target.port });
      setClearState("cleared");
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(() => setClearState("idle"), 2000);
    } catch {
      setClearState("idle");
      setError("清除已保存密码失败，请稍后重试");
    }
  };

  return createPortal(
    <div className="modal-scrim ssh-dialog__scrim">
      <form
        aria-labelledby="ssh-dialog-title"
        aria-describedby={editing ? "ssh-dialog-hint" : undefined}
        aria-modal="true"
        className="modal modal--ssh"
        onKeyDown={trapDialogFocus}
        onSubmit={submit}
        ref={panelRef}
        role="dialog"
      >
        <header className="ssh-dialog__head">
          <div className="ssh-dialog__heading">
            <strong className="ssh-dialog__title" id="ssh-dialog-title">
              {editing ? "编辑 SSH 连接" : "SSH 连接"}
            </strong>
            {editing ? <span id="ssh-dialog-hint">保存后将重启当前 SSH 会话</span> : null}
          </div>
          <button
            aria-label="关闭 SSH 连接弹框"
            className="icon-button icon-button--sm"
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" size={ICON.md} />
          </button>
        </header>

        <label className="ssh-form__field">
          <span>主机</span>
          <input
            aria-invalid={error === "主机不能为空" || error === "主机名不合法"}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(event) => {
              setHost(event.target.value);
              setError(null);
            }}
            placeholder="example.com 或 ssh 别名"
            ref={hostRef}
            spellCheck={false}
            value={host}
          />
        </label>

        <div className="ssh-form__row">
          <label className="ssh-form__field">
            <span>用户名（可选）</span>
            <input
              aria-invalid={error === "用户名不合法"}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => {
                setUser(event.target.value);
                setError(null);
              }}
              placeholder="root"
              spellCheck={false}
              value={user}
            />
          </label>
          <label className="ssh-form__field">
            <span>端口（可选）</span>
            <input
              aria-invalid={error === "端口需在 1–65535 之间"}
              inputMode="numeric"
              onChange={(event) => {
                setPort(event.target.value);
                setError(null);
              }}
              placeholder="22"
              value={port}
            />
          </label>
        </div>

        <label className="ssh-form__field">
          <span>密码</span>
          <input
            autoCapitalize="none"
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="连接密码"
            type="password"
            value={password}
          />
        </label>

        <div className="ssh-form__foot">
          <label className="ssh-form__remember">
            <input
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              type="checkbox"
            />
            <span>记住密码，下次自动填入</span>
          </label>
          <button
            className="ssh-form__clear"
            disabled={clearState === "clearing"}
            onClick={() => void clearSaved()}
            type="button"
          >
            {clearButtonLabel(clearState)}
          </button>
        </div>

        <div className="ssh-form__feedback" aria-live="polite">
          {error ? <p className="ssh-form__error">{error}</p> : null}
        </div>

        <div className="modal__actions ssh-dialog__actions">
          <button onClick={onCancel} type="button">取消</button>
          <button className="modal__primary" type="submit">{editing ? "保存并重连" : "连接"}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function clearButtonLabel(state: "idle" | "clearing" | "cleared") {
  if (state === "clearing") return "正在清除…";
  if (state === "cleared") return "已清除";
  return "清除已保存密码";
}

function trapDialogFocus(event: KeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** 与后端 SshTarget 校验保持一致：主机名必须能安全地作为单个参数传给 ssh。 */
export function parseSshTarget(
  host: string,
  user: string,
  port: string,
  password: string,
  remember: boolean,
): SshLaunch | string {
  const targetHost = host.trim();
  if (!targetHost) return "主机不能为空";
  if (
    targetHost.length > 255
    || /\s/.test(targetHost)
    || targetHost.includes("/")
    || targetHost.includes("\\")
    || targetHost.startsWith("-")
  ) {
    return "主机名不合法";
  }
  const targetUser = user.trim();
  if (
    targetUser
    && (
      targetUser.length > 255
      || /\s/.test(targetUser)
      || targetUser.includes("@")
      || targetUser.startsWith("-")
    )
  ) {
    return "用户名不合法";
  }
  let targetPort: number | null = null;
  const portText = port.trim();
  if (portText) {
    targetPort = Number(portText);
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      return "端口需在 1–65535 之间";
    }
  }
  // 密码留空 + 勾选记住 = 使用已保存的密码，由后端从系统钥匙串读取。
  const targetPassword = password;
  return {
    host: targetHost,
    user: targetUser || null,
    port: targetPort,
    password: targetPassword || null,
    rememberPassword: remember,
  };
}
