!include "LogicLib.nsh"

; Language IDs are explicit because Tauri includes hooks before MUI language macros.
LangString BelfryCleanupLauncherRetry 1033 "OpenConsole cleanup launcher failed; retrying with ExecWait."
LangString BelfryCleanupLauncherRetry 2052 "OpenConsole 清理启动器失败，正在通过 ExecWait 重试。"
LangString BelfryCleanupFailed 1033 "OpenConsole cleanup failed ($0)."
LangString BelfryCleanupFailed 2052 "OpenConsole 清理失败（$0）。"
LangString BelfryCleanupRetry 1033 "OpenConsole cleanup did not complete ($0).$\r$\n$\r$\nSee Show details for the error. If the file is in use, close Belfry and terminals using this installation, then retry. If PowerShell could not start, check that Windows PowerShell is available and allowed to run."
LangString BelfryCleanupRetry 2052 "OpenConsole 清理未完成（$0）。$\r$\n$\r$\n请展开“显示详情”查看错误。如果文件正在使用，请关闭 Belfry 及使用此安装目录的终端后重试。如果 PowerShell 未能启动，请确认 Windows PowerShell 可用且允许运行。"
LangString BelfryCleanupPowerShell 1033 "Unable to start PowerShell for OpenConsole cleanup: $1"
LangString BelfryCleanupPowerShell 2052 "无法启动 PowerShell 来清理 OpenConsole：$1"
LangString BelfryCleanupTimeout 1033 "OpenConsole cleanup timed out."
LangString BelfryCleanupTimeout 2052 "OpenConsole 清理超时。"
LangString BelfryCleanupEnvironment 1033 "Unable to prepare the OpenConsole cleanup environment."
LangString BelfryCleanupEnvironment 2052 "无法准备 OpenConsole 清理环境。"
LangString BelfryCleanupInUse 1033 "OpenConsole cleanup failed; the host may still be in use or not writable."
LangString BelfryCleanupInUse 2052 "OpenConsole 清理失败，进程可能仍在使用中，或文件不可写。"
LangString BelfryCleanupAbort 1033 "OpenConsole cleanup did not complete. See the details above."
LangString BelfryCleanupAbort 2052 "OpenConsole 清理未完成，请查看上方详情。"

!define BELFRY_WINDOWS_HOOKS_DIR "${__FILEDIR__}"
!define BELFRY_OPENCONSOLE_TIMEOUT_MS 15000

; NSIS is normally 32-bit. Its default PowerShell cannot read a 64-bit
; OpenConsole's Path, so use native PowerShell through Sysnative when available.
; The script matches the full path and waits for the executable to be writable.
!macro BELFRY_STOP_OPENCONSOLE
  Push $0
  Push $1
  InitPluginsDir
  File "/oname=$PLUGINSDIR\belfry-stop-openconsole.ps1" "${BELFRY_WINDOWS_HOOKS_DIR}\stop-openconsole.ps1"
  StrCpy $1 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
    StrCpy $1 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"

  belfry_openconsole_retry:
  ; Pass the path as data, preserving spaces and PowerShell metacharacters.
  System::Call 'kernel32::SetEnvironmentVariable(t "BELFRY_OPENCONSOLE_PATH", t "$INSTDIR\OpenConsole.exe") i .r0'
  ${If} $0 != 0
    nsExec::ExecToLog /TIMEOUT=${BELFRY_OPENCONSOLE_TIMEOUT_MS} '"$1" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\belfry-stop-openconsole.ps1"'
    Pop $0
    ${If} $0 == "error"
      ; nsExec can fail before PowerShell starts. Retry using NSIS's native
      ; launcher; never treat a launcher failure as proof of a locked file.
      DetailPrint "$(BelfryCleanupLauncherRetry)"
      ClearErrors
      ExecWait '"$1" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\belfry-stop-openconsole.ps1"' $0
      ${If} ${Errors}
        StrCpy $0 "launch failed"
      ${EndIf}
    ${EndIf}
  ${Else}
    StrCpy $0 "environment setup failed"
  ${EndIf}
  System::Call 'kernel32::SetEnvironmentVariable(t "BELFRY_OPENCONSOLE_PATH", p 0)'

  ${If} $0 != "0"
    DetailPrint "$(BelfryCleanupFailed)"
    ${IfNot} ${Silent}
    ${AndIf} $PassiveMode != 1
      MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "$(BelfryCleanupRetry)" /SD IDCANCEL IDRETRY belfry_openconsole_retry
    ${EndIf}
    ${If} $0 == "launch failed"
      DetailPrint "$(BelfryCleanupPowerShell)"
    ${ElseIf} $0 == "timeout"
      DetailPrint "$(BelfryCleanupTimeout)"
    ${ElseIf} $0 == "environment setup failed"
      DetailPrint "$(BelfryCleanupEnvironment)"
    ${Else}
      DetailPrint "$(BelfryCleanupInUse)"
    ${EndIf}
    Pop $1
    Pop $0
    SetErrorLevel 1
    Abort "$(BelfryCleanupAbort)"
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; Tauri calls PREINSTALL before its own running-app check. Close the app first
  ; so it cannot create another console host while cleanup is running.
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro BELFRY_STOP_OPENCONSOLE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  !insertmacro BELFRY_STOP_OPENCONSOLE
!macroend
