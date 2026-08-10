# 随包分发的 ConPTY

来源：NuGet 包 [`Microsoft.Windows.Console.ConPTY`](https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY)
`1.24.260710001`（MIT，© Microsoft Corporation，源码在 [microsoft/terminal](https://github.com/microsoft/terminal)）。

| 仓库里的文件 | 包内路径 |
| --- | --- |
| `x64/conpty.dll` | `runtimes/win-x64/native/conpty.dll` |
| `x64/OpenConsole.exe` | `build/native/runtimes/x64/OpenConsole.exe` |
| `arm64/conpty.dll` | `runtimes/win-arm64/native/conpty.dll` |
| `arm64/OpenConsole.exe` | `build/native/runtimes/arm64/OpenConsole.exe` |

## 为什么要带

系统自带的 conhost 只有 **1.22 及以上**才会把 `OSC 10/11` 颜色查询透传给 ConPTY 的宿主。
更早的版本会自己截胡，用 conhost 内置的 Campbell 调色板作答——背景色永远是 `#0C0C0C`。
于是 Codex 一类会探测背景色的 TUI 在亮色主题下判定成暗色，把输入框画成黑块。

带上新版 conpty 就跟系统版本脱钩了，`src-tauri/src/terminal/osc.rs` 的应答才有机会被问到。
VS Code / node-pty 也是这么做的。

## 怎么被加载

`portable-pty` 会先试 `LoadLibrary("conpty.dll")`，命中就用它，否则退回 `kernel32`。
DLL 搜索的第一站是 exe 所在目录，所以两个文件都要落在 `Otty.exe` 旁边——
`conpty.dll` 自己会在**它所在的目录**里找 `OpenConsole.exe`，找不到就回落到系统 conhost。

落地由 `build.rs` 按目标架构挑一份放进 `active/`（构建产物，已 gitignore），
再由 `tauri.windows.conf.json` 的 `bundle.resources` 装进安装包。

失败路径都是软的：架构不对则 `LoadLibrary` 失败、少了 `OpenConsole.exe` 则回落系统 conhost，
两种情况都只是退回旧行为，不会崩。

## 怎么升级

```sh
V=<新版本号>
curl -sL -o /tmp/conpty.nupkg \
  "https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/$V/microsoft.windows.console.conpty.$V.nupkg"
unzip -o -q /tmp/conpty.nupkg -d /tmp/conpty-pkg
```
再按上表把四个文件覆盖进来，并更新本文件里的版本号。
