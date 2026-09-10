import { open } from "@tauri-apps/plugin-dialog";
import { usePluginsPage } from "./context";
import { Button, Input } from "./ui";
import { centerApi } from "./api";
import { pluginNotice } from "../notices";
import type { CenterActions } from "./useCenterActions";
import { usePersonalMarketName } from "./usePersonalMarketName";

export function PersonalMarketControls() {
  const { actions, setPublishDirectory } = usePluginsPage();
  const marketName = usePersonalMarketName();
  const afterNameSaved = async (operation: () => Promise<void>) => {
    if (await marketName.save()) await operation();
  };
  return <div className="plugins-personal-market">
    <label className="plugins-market-name"><span className="settings-row-title">市场名称</span>
      <Input aria-label="市场名称" value={marketName.name} maxLength={100} disabled={actions.busy || marketName.loading || marketName.saving}
        onChange={(event) => marketName.setName(event.target.value)} onBlur={() => void marketName.save()}
        onKeyDown={(event) => { if (event.key === "Enter") void marketName.save(); }} /></label>
    {marketName.error ? <p className="plugins-inline-error" role="alert">{marketName.error}</p> : null}
    <p className="settings-row-desc">导出的市场包含独立网页和插件包，可直接部署到自己的网址。</p>
    <div className="plugins-personal-actions">
      <Button variant="primary" disabled={actions.busy || marketName.loading}
        onClick={() => void afterNameSaved(() => choosePublication(actions, setPublishDirectory))}>发布已有插件</Button>
      <Button disabled={actions.busy || marketName.loading}
        onClick={() => void afterNameSaved(() => exportOwnMarket(actions))}>导出市场网站</Button>
    </div>
  </div>;
}

export async function choosePublication(actions: CenterActions, choose: (directory: string) => void) {
  await actions.run(async () => {
    const directory = await open({ directory: true, multiple: false, title: "选择要发布的插件源码目录" });
    if (typeof directory === "string") choose(directory);
  });
}
export async function exportOwnMarket(actions: CenterActions) {
  await actions.run(async () => {
    const directory = await open({ directory: true, multiple: false, title: "选择空目录以导出市场网站" });
    if (typeof directory !== "string") return;
    const result = await centerApi.exportMarket(directory);
    pluginNotice(`已导出市场网站，包含 ${result.pluginCount} 个插件`);
    await centerApi.reveal(result.directory);
  });
}
