import { t, useTranslation } from "../i18n";
import { useState } from "react";
import { cancelPendingBackup } from "./transaction";
import { message } from "./contracts";
import "./backup.css";

export function BackupRecovery({ error }: { error: string }) {
  useTranslation();
  const [detail, setDetail] = useState(error);
  const cancel = () => {
    try { cancelPendingBackup(); window.location.reload(); } catch (error) { setDetail(message(error)); }
  };
  return <main className="backup-recovery"><h1>{t("backup.BackupRecovery.text_1af16f3df3")}</h1>
    <p>{t("backup.BackupRecovery.text_8b5dcccff2")}</p><p role="alert">{detail}</p>
    <div className="backup-actions"><button type="button" onClick={() => window.location.reload()}>{t("backup.BackupRecovery.text_87cfc9d811")}</button>
      <button type="button" onClick={cancel}>{t("backup.BackupRecovery.text_107b4b55ab")}</button></div>
  </main>;
}
