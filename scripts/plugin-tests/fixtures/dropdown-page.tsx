import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingControl } from "../../../src/plugins/center/SettingControl";
import { useModal } from "../../../src/plugins/center/useModal";
import type { PluginSettingDefinition } from "../../../src/plugins/center/types";
import "../../../src/styles.css";
import "../../../src/plugins/center/styles/index.css";

const FIELDS: PluginSettingDefinition[] = [
  { key: "mode", title: "设置类型", type: "select", enum: [
    { value: 2, label: "数字二" }, { value: "2", label: "文本二" }, { value: false, label: "关闭" },
  ] },
  { key: "missing", title: "未匹配设置", type: "select", enum: [{ value: "first", label: "第一项" }] },
  { key: "empty", title: "空选项", type: "select", enum: [] },
  { key: "long", title: "较长选项", type: "select", enum: Array.from({ length: 20 }, (_, value) => ({ value, label: `选项 ${value}` })) },
];

function DropdownPage() {
  const [visible, setVisible] = useState(true), [disabled, setDisabled] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({ mode: 2, missing: "unknown", long: 0 });
  const ref = useModal(() => setVisible(false));
  return <div className="pi-plugins">
    {visible ? <div className="plugins-modal-backdrop" ref={ref}><div className="plugins-modal plugins-settings-modal" role="dialog" aria-label="下拉框设置">
      <header className="plugins-modal-head"><button aria-label="关闭设置" onClick={() => setVisible(false)}>关闭</button></header>
      <div className="plugins-settings-body" style={{ height: 180, flexShrink: 0 }}>
        {FIELDS.map((setting) => <div className="plugins-setting-row" key={setting.key}>
          <div className="plugins-setting-copy">{setting.title}</div>
          <div className="plugins-setting-control"><SettingControl setting={setting} value={values[setting.key]} disabled={disabled}
            onChange={(value) => setValues((current) => ({ ...current, [setting.key]: value }))} /></div>
        </div>)}
      </div>
      <footer className="plugins-modal-actions"><button id="toggle-disabled" onClick={() => setDisabled(!disabled)}>切换禁用</button><button id="after-settings">保存</button></footer>
    </div></div> : null}
    <output id="settings-values">{JSON.stringify(values)}</output>
  </div>;
}

createRoot(document.getElementById("root")!).render(<DropdownPage />);
