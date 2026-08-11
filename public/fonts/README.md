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

## 为什么只有 400 和 500

`src/styles.css` 设了 `font-synthesis: none`——浏览器不会合成假粗体。这意味着
**任何 600/700 的 `font-weight` 声明都不会变粗，而是掉回常规字重**。全站字重必须
收敛在这两档；发现某处该粗不粗时，先查那里的 `font-weight`，不要去掉
`font-synthesis`（合成粗体在中文上尤其难看）。

## 子集范围

汉字取 GB2312（6763 字），加拉丁、标点、货币、箭头、制表符等 13 个补充区段，
最终每个字重约 930 KB。直接取 `U+4E00-9FFF` 全段是 20992 字，体积翻三倍，不划算。

GB2312 覆盖现代中文约 99.7%。界面上出现的只有项目名、路径、模型名和固定文案，
够用；真遇到生僻字会 fallback 到系统字体。如果发现常用字缺失，改
`scripts/build-fonts.py` 的 `EXTRA_RANGES` 或换用更大的字表重新生成。

子集保留了 hinting：Windows 的 DirectWrite 在小字号下依赖它，去掉会明显发糊。

## 等宽字体不含中文

`JetBrainsMono-Regular.woff2` 只有拉丁字符（216 字形），含中文的路径会 fallback
到系统中文字体。这是**有意为之**：JetBrains Mono 西文字宽 0.6 em，两格 1.2 em，
而全角中文是 1.0 em，只占 1.67 格——任何全角中文字体配进等宽栈都会让终端里的
中文略窄于两格。既然换成打包字体也解决不了，就不引入这个变量。

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
