# Belfry · 设计资产与品牌边界

## 本地权威来源

- 产品结构：当前仓库 `src/components/Workbench.tsx`、`WorkbenchToolbar.tsx`、`AppOverlays.tsx`、`src/workspace/components/Sidebar.tsx`、`src/settings/SettingsPanel.tsx`。
- 图标：`src-tauri/icons/icon.png`，本次只复制为 `assets/belfry.png`，不重画或改变标志。
- 现有界面截图：`docs/screenshots/workspace-dark.png`、`workspace-light.png`、`provider.png`、`usage.png`、`plugins.png`。原型布局由代码结构及现有交互约束推导，不声称已逐张视觉核对这些历史截图。
- 当前主题色：`src/styles.css` 的深色 accent `#6e8bff`、亮色 accent `#3b5bdb`。绿色是这次拟议的新设计强调色，不冒充现行官方品牌色。
- 中文字体：`public/fonts/HarmonyOSSansSC-Regular.woff2`、`HarmonyOSSansSC-Medium.woff2`，只使用 400/500 字重。
- 等宽字体：`public/fonts/JetBrainsMono-Regular.woff2`、`JetBrainsMono-Medium.woff2`、`JetBrainsMono-SemiBold.woff2`，用于路径、命令与终端样例。

## 表达与素材约束

主视觉来自终端、会话轨道、项目层级和上下文信息，不加入装饰摄影、通用 AI 生成插画、霓虹渐变、营销 KPI 或虚构客户证言。原型只使用 Belfry 自有标志；CLI Agent 名作为功能标签，不重画第三方品牌图形。

所有项目、主机、终端文本、统计与 Provider 示例是设计演示数据，统一在界面标注。地址使用 `example.invalid`，不复制当前用户配置、真实凭据、生产日志或终端历史。键值编辑仅为模拟交互，不持久化密钥。

## 原型形态

多文件可交互 HTML，随仓库位置使用；本地图片与字体相对路径加载，无 CDN、外部字体或跟踪脚本。不是可随意移出目录的单文件独立包。打开入口为 `docs/design/belfry-ui/index.html`。
