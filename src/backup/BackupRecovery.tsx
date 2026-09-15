import { useState } from "react";
import { cancelPendingBackup } from "./transaction";
import { message } from "./contracts";
import "./backup.css";

export function BackupRecovery({ error }: { error: string }) {
  const [detail, setDetail] = useState(error);
  const cancel = () => {
    try { cancelPendingBackup(); window.location.reload(); } catch (error) { setDetail(message(error)); }
  };
  return <main className="backup-recovery"><h1>备份恢复需要处理</h1>
    <p>工作区尚未启动。先完成回滚，避免覆盖未恢复的配置。</p><p role="alert">{detail}</p>
    <div className="backup-actions"><button type="button" onClick={() => window.location.reload()}>重试恢复</button>
      <button type="button" onClick={cancel}>取消尚未执行的恢复</button></div>
  </main>;
}
