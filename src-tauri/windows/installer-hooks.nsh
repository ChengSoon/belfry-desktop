!include "LogicLib.nsh"

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
      DetailPrint "OpenConsole cleanup launcher failed; retrying with ExecWait."
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
    DetailPrint "OpenConsole cleanup failed ($0)."
    ${IfNot} ${Silent}
    ${AndIf} $PassiveMode != 1
      MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "OpenConsole cleanup did not complete ($0).$\r$\n$\r$\nSee Show details for the error. If the file is in use, close Belfry and terminals using this installation, then retry. If PowerShell could not start, check that Windows PowerShell is available and allowed to run." /SD IDCANCEL IDRETRY belfry_openconsole_retry
    ${EndIf}
    ${If} $0 == "launch failed"
      DetailPrint "Unable to start PowerShell for OpenConsole cleanup: $1"
    ${ElseIf} $0 == "timeout"
      DetailPrint "OpenConsole cleanup timed out."
    ${ElseIf} $0 == "environment setup failed"
      DetailPrint "Unable to prepare the OpenConsole cleanup environment."
    ${Else}
      DetailPrint "OpenConsole cleanup failed; the host may still be in use or not writable."
    ${EndIf}
    Pop $1
    Pop $0
    SetErrorLevel 1
    Abort "OpenConsole cleanup did not complete. See the details above."
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
