import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BackgroundProvider } from "./background/BackgroundProvider";
import "./styles.css";
// 放在最后：各面板的 CSS 由组件自己 import，模块图里排在 App 之下、早于这里注入。
// 外壳规格要压过它们各自的头部定义，只能靠"同特异性、后来居上"。
import "./panel/panelShell.css";
import "./settings/settingsShell.css";
import { ThemeProvider } from "./theme/ThemeProvider";
import { TypographyProvider } from "./typography/TypographyProvider";
import { applyPendingBackup } from "./backup/transaction";
import { BackupRecovery } from "./backup/BackupRecovery";
import { TerminalExitDialog } from "./terminal/daemon/ExitDialog";

const roomId = new URLSearchParams(window.location.search).get("room");
if (roomId) {
  // 房间独立窗口：只挂房间视图。工作台、备份事务与退出确认都属于主窗口，
  // 第二个窗口再跑一遍不是「多一份保险」，而是两份各说各话的现场。
  const RoomWindowApp = lazy(() =>
    import("./rooms/window/RoomWindow").then((module) => ({ default: module.RoomWindowApp })));
  createRoot(document.getElementById("root")!).render(
    <ThemeProvider>
      <TypographyProvider>
        <BackgroundProvider>
          <Suspense fallback={null}>
            <RoomWindowApp roomId={roomId} />
          </Suspense>
        </BackgroundProvider>
      </TypographyProvider>
    </ThemeProvider>,
  );
} else {
  const backupStartup = applyPendingBackup();
  createRoot(document.getElementById("root")!).render(
    <><TerminalExitDialog />{backupStartup.error ? <BackupRecovery error={backupStartup.error} /> : <ThemeProvider>
      <TypographyProvider>
        <BackgroundProvider>
          <App />
        </BackgroundProvider>
      </TypographyProvider>
    </ThemeProvider>}</>,
  );
}
