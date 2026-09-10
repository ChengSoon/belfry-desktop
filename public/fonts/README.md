# 打包字体

中文字体随应用分发，不依赖系统安装。Windows 上原先落到微软雅黑，小字号笔画细、
发灰，这是界面观感"不饱满"的主因；打包后 Windows 与 macOS 的**中文**显示一致。

**西文不用 HarmonyOS。** 两个 `@font-face` 都加了 `unicode-range`，只圈中日韩区段：
HarmonyOS 的拉丁字形偏宽偏大，同字号下比系统字体重一档，在侧栏这类窄而密的列表里
显得挤，西文交给 `-apple-system` / `Segoe UI` 更贴各自平台。

这**不能**靠把系统字体排在 `HarmonyOS Sans SC` 前面来实现：macOS 的 `-apple-system`
自带一套 CJK 回退，中文会先命中苹方，排在它后面的打包字体永远轮不到，两个平台的中文
就不一致了。划了 range 之后顺序反过来才对——HarmonyOS 放最前，西文码点不匹配自动跳过。
改字体栈顺序前先读这段。

| 文件 | 用途 | 上游 |
|---|---|---|
| `HarmonyOSSansSC-Regular.woff2` | `--font-sans` 中文 400 | HarmonyOS Sans SC 2.0（华为） |
| `HarmonyOSSansSC-Medium.woff2` | `--font-sans` 中文 500 | 同上 |
| `JetBrainsMono-Regular.woff2` | `--font-mono` 400 | `@fontsource/jetbrains-mono@5.3.0` |
| `JetBrainsMono-Medium.woff2` | 终端正文 500 / 暗色强调 | 同上 |
| `JetBrainsMono-SemiBold.woff2` | 亮色终端强调 600 | 同上 |

## 字重与 Windows 默认字体

`src/styles.css` 设了 `font-synthesis: none`，UI 中文仍使用真实的 400/500。
终端的 JetBrains Mono 另带 600：亮色使用 500/600，暗色使用 400/500。
不要用 CSS 字重数值替代缺失的字体文件；只有 Regular 的字体请求 500 时仍可能
匹配到 400。实测补齐 Medium 后，15px 西文笔画墨量增加约 14–17%，字宽不变。

Windows 的默认等宽字体优先使用内置 JetBrains Mono，中文回退到 HarmonyOS Sans SC。
这样小字号正文与强调都有稳定的真实字重，不依赖 Windows 是否安装 Cascadia Mono。
macOS 保留原来的系统字体栈，用户自行选择或导入的字体始终排在默认字体之前。
首帧 CSS 与运行时字体栈分别在 `src/styles.css`、`src/typography/storage.ts` 中维护。

`src/terminal/fontRendering.ts` 会加载 Regular、当前正文和粗体，样本文本同时包含
西文和中文。终端首次挂载、换字体或换主题后，等加载结束再清理字形图集并重新测量，
避免 WebGL 长期沿用字体尚未就绪时生成的回退字形。

## 子集范围

汉字取 GB2312（6763 字），加拉丁、标点、货币、箭头、制表符等 13 个补充区段，
最终每个字重约 930 KB。直接取 `U+4E00-9FFF` 全段是 20992 字，体积翻三倍，不划算。

GB2312 覆盖现代中文约 99.7%。界面上出现的只有项目名、路径、模型名和固定文案，
够用；真遇到生僻字会 fallback 到系统字体。如果发现常用字缺失，改
`scripts/build-fonts.py` 的 `EXTRA_RANGES` 或换用更大的字表重新生成。

子集保留了 hinting：Windows 的 DirectWrite 在小字号下依赖它，去掉会明显发糊。

## 等宽字体不含中文

JetBrains Mono 子集只有拉丁字符（每个字重 234 个字形），中文由字体栈后面的
中文字体承担。Windows 现在显式使用已打包的 HarmonyOS，保证中文的字重也能生效。
JetBrains Mono 西文字宽 0.6 em，两格 1.2 em；中文通常为 1.0 em，字面会略窄于
两格。终端仍按 Unicode provider 将中文作为两格处理，不能靠拉伸字形补齐宽度。

## 重新生成

产物已入库，日常开发不需要跑。只有换字体或调子集范围时才需要：

```bash
pip3 install fonttools brotli
python3 scripts/build-fonts.py
```

脚本从 `/tmp/belfry-fonts/` 读上游源文件，需要先手动准备：

```bash
mkdir -p /tmp/belfry-fonts && cd /tmp/belfry-fonts
curl -sLO https://registry.npmjs.org/harmonyos-sans/-/harmonyos-sans-1.0.0.tgz
tar xzf harmonyos-sans-1.0.0.tgz && unzip -q "package/HarmonyOS Sans.zip" -d unpacked
curl -sL -o jbmono.tgz https://registry.npmjs.org/@fontsource/jetbrains-mono/-/jetbrains-mono-5.3.0.tgz
tar xzf jbmono.tgz
```

`harmonyos-sans` 那个 npm 包解包有 49.8 MB（全语言变体、全字重），只是用来拿官方
zip，**不要加进 `package.json`**。

## 许可

- **HarmonyOS Sans** — HarmonyOS Sans Fonts License Agreement（`LICENSE-HarmonyOS-Sans.txt`）。
  免费商用，授权含 `embed`、`bundle`、`redistribute`。注意其中一条限制：
  不得以**独立形式**再分发或销售字体本身；嵌入应用一起分发不受此限。
- **JetBrains Mono** — SIL Open Font License 1.1（`LICENSE-JetBrains-Mono.txt`）。

两份许可文件随字体一同分发，不要删。
