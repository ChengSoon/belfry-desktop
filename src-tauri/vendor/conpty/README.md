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
DLL 搜索的第一站是 exe 所在目录，所以两个文件都要落在 `Belfry.exe` 旁边——
`conpty.dll` 自己会在**它所在的目录**里找 `OpenConsole.exe`，找不到就回落到系统 conhost。

落地由 `build.rs` 按目标架构挑一份放进 `active/`（构建产物，已 gitignore），
再由 `tauri.windows.conf.json` 的 `bundle.resources` 装进安装包。

失败路径都是软的：架构不对则 `LoadLibrary` 失败、少了 `OpenConsole.exe` 则回落系统 conhost，
两种情况都只是退回旧行为，不会崩。

## 安装与升级时的文件占用

`OpenConsole.exe` 是独立进程，可能在 Belfry 退出后短暂存活并锁住安装目录中的文件。
`windows/installer-hooks.nsh` 在安装和卸载前先执行 Tauri 的主程序关闭检查，再调用
`windows/stop-openconsole.ps1`，只终止完整路径与本次安装目录匹配的宿主。

NSIS 通常是 32 位进程，因此必须优先通过 `Sysnative` 启动系统原生位数的 PowerShell。
32 位 PowerShell 查询 64 位进程时，`Get-Process.Path` 会为空，导致按路径筛选失效。
清理后还会最多等待 5 秒，使用不截断、不写入内容的文件打开操作确认锁已释放；失败时
在复制或删除应用文件前停止，交互安装可重试，静默和被动安装返回失败。

在仓库根目录运行脚本回归（不依赖 Pester）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-installer.ps1
```

也可用 `pwsh` 执行。这些用例模拟进程枚举与终止，并用真实文件句柄验证锁等待；
Windows 发布前仍需验证旧版运行中覆盖安装、卸载，以及其他目录的同名宿主不受影响。

## 怎么升级

```sh
V=<新版本号>
curl -sL -o /tmp/conpty.nupkg \
  "https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/$V/microsoft.windows.console.conpty.$V.nupkg"
unzip -o -q /tmp/conpty.nupkg -d /tmp/conpty-pkg
```
再按上表把四个文件覆盖进来，并更新本文件里的版本号。
