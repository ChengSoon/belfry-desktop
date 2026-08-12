; OpenConsole.exe is the out-of-process host used by our bundled ConPTY runtime.
; It can briefly survive Belfry during an update and keep the installed executable
; locked, which makes NSIS fail while overwriting or removing it.
;
; Match the full executable path instead of using `taskkill /IM OpenConsole.exe`:
; Windows Terminal and other applications can have a process with the same name.
!macro BELFRY_STOP_OPENCONSOLE
  ; Passing a value after powershell.exe -Command does not populate $args reliably.
  ; A process-scoped environment variable also preserves spaces in $INSTDIR.
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i("BELFRY_OPENCONSOLE_PATH", "$INSTDIR\OpenConsole.exe").r0'
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$$target = [IO.Path]::GetFullPath($$env:BELFRY_OPENCONSOLE_PATH); Get-Process -Name OpenConsole -ErrorAction SilentlyContinue | Where-Object { try { [IO.Path]::GetFullPath($$_.Path) -eq $$target } catch { $$false } } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0
  System::Call 'kernel32::SetEnvironmentVariable(t, t)i("BELFRY_OPENCONSOLE_PATH", "").r0'
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro BELFRY_STOP_OPENCONSOLE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro BELFRY_STOP_OPENCONSOLE
!macroend
