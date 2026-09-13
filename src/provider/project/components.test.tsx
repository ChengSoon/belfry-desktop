import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProjectProviderRow, ProjectProviderSection, projectProviderOptions } from "./ProjectProviderSection";
import type { ProjectAgentProvider } from "./contracts";
import { providerSource } from "./model";

const group: ProjectAgentProvider = {
  kind: "codex", providerId: "a", source: "project", effectiveName: "服务 A", missing: false,
  choices: [{ id: "a", name: "服务 A", baseUrl: "https://a.example.invalid", model: "", configured: true }],
};
const render = (value: ProjectAgentProvider) => renderToStaticMarkup(<ProjectProviderRow group={value} disabled={false} onSelect={() => {}} />);

it("呈现项目来源、选中项和继承模型说明", () => {
  const html = render(group);
  expect(html).toContain("项目覆盖 · 服务 A");
  expect(html).toContain('title="服务 A"');
  expect(html).toContain('role="combobox"');
  expect(html).toContain("沿用 CLI 模型设置");
  expect(projectProviderOptions(group)[0]).toEqual({ value: "", label: "跟随全局 CLI 配置" });
});

it("已删除的 Provider 显示错误，不能冒充全局已生效", () => {
  const missing = { ...group, missing: true, choices: [] };
  const html = render(missing);
  expect(html).toContain('role="alert"');
  expect(html).toContain("已删除的 Provider");
  expect(providerSource(missing)).not.toContain("跟随全局 ·");
});

it("没有本地项目时解释 SSH 边界，不出现可写入的选择器", () => {
  const html = renderToStaticMarkup(<ProjectProviderSection project={null} />);
  expect(html).toContain("先打开一个本地项目");
  expect(html).not.toContain('role="combobox"');
});

it("未配置独立凭据的条目不可选择，来源可退回全局", () => {
  const unconfigured = { ...group, source: "global" as const, providerId: null, choices: [{ ...group.choices[0], configured: false }] };
  const html = render(unconfigured);
  expect(html).toContain("跟随全局 · 服务 A");
  expect(projectProviderOptions(unconfigured)[1]).toMatchObject({ value: "a", disabled: true, description: "未配置独立 API Key" });
  expect(projectProviderOptions(unconfigured)[0].disabled).not.toBe(true);
});
