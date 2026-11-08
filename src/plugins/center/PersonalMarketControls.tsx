import { t, useTranslation } from "../../i18n";
import { open } from "@tauri-apps/plugin-dialog";
import { usePluginsPage } from "./context";
import { Button, Input } from "./ui";
import { centerApi } from "./api";
import { pluginNotice } from "../notices";
import type { CenterActions } from "./useCenterActions";
import { usePersonalMarketName } from "./usePersonalMarketName";
import { composingKey } from "../../utils/keyboard";

export function PersonalMarketControls() {
  useTranslation();
  const { actions, setPublishDirectory } = usePluginsPage();
  const marketName = usePersonalMarketName();
  const afterNameSaved = async (operation: () => Promise<void>) => {
    if (await marketName.save()) await operation();
  };
  return <div className="plugins-personal-market">
    <label className="plugins-market-name"><span className="settings-row-title">{t("plugins.PersonalMarketControls.text_d36319004d")}</span>
      <Input aria-label={t("plugins.PersonalMarketControls.text_d36319004d")} value={marketName.name} maxLength={100} disabled={actions.busy || marketName.loading || marketName.saving}
        onChange={(event) => marketName.setName(event.target.value)} onBlur={() => void marketName.save()}
        onKeyDown={(event) => { if (!composingKey(event.nativeEvent) && event.key === "Enter") void marketName.save(); }} /></label>
    {marketName.error ? <p className="plugins-inline-error" role="alert">{marketName.error}</p> : null}
    <p className="settings-row-desc">{t("plugins.PersonalMarketControls.text_1d37712e54")}</p>
    <div className="plugins-personal-actions">
      <Button variant="primary" disabled={actions.busy || marketName.loading}
        onClick={() => void afterNameSaved(() => choosePublication(actions, setPublishDirectory))}>{t("plugins.PersonalMarketControls.text_5f1e474dd7")}</Button>
      <Button disabled={actions.busy || marketName.loading}
        onClick={() => void afterNameSaved(() => exportOwnMarket(actions))}>{t("plugins.PersonalMarketControls.text_a8420f92c9")}</Button>
    </div>
  </div>;
}

export async function choosePublication(actions: CenterActions, choose: (directory: string) => void) {
  await actions.run(async () => {
    const directory = await open({ directory: true, multiple: false, title: t("plugins.PersonalMarketControls.text_b9ceb49ec8") });
    if (typeof directory === "string") choose(directory);
  });
}
export async function exportOwnMarket(actions: CenterActions) {
  await actions.run(async () => {
    const directory = await open({ directory: true, multiple: false, title: t("plugins.PersonalMarketControls.text_b2c5818762") });
    if (typeof directory !== "string") return;
    const result = await centerApi.exportMarket(directory);
    pluginNotice(t("plugins.PersonalMarketControls.text_4c48d414e9", { count: result.pluginCount }));
    await centerApi.reveal(result.directory);
  });
}
