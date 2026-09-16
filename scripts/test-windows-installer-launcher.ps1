param([string] $MakeNsis = 'makensis.exe')

# Run on Windows with NSIS installed. This exercises the actual NSIS hook and
# native Windows PowerShell, without terminating any real console processes.
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('belfry-launcher-test-' + [guid]::NewGuid())
$hooksDirectory = Join-Path $PSScriptRoot '../src-tauri/windows'
$utf8 = New-Object Text.UTF8Encoding($false)
$template = @'
Unicode true
!include "LogicLib.nsh"
!include "installer-hooks.nsh"
Name "Belfry launcher regression"
OutFile "test-installer.exe"
RequestExecutionLevel user
SilentInstall silent
Var PassiveMode
Section
  StrCpy $INSTDIR "$EXEDIR\Belfry Test's & ()"
  StrCpy $0 "saved-zero"
  StrCpy $1 "saved-one"
  !insertmacro BELFRY_STOP_OPENCONSOLE
  StrCmp $0 "saved-zero" 0 failed
  StrCmp $1 "saved-one" 0 failed
  SetErrorLevel 0
  Goto done
  failed:
  SetErrorLevel 2
  done:
SectionEnd
'@

function Test-Launcher([string] $Mode, [int] $ExpectedExit) {
    $directory = Join-Path $root $Mode
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $hooks = Get-Content (Join-Path $hooksDirectory 'installer-hooks.nsh') -Raw
    if ($Mode -ne 'normal') {
        # Inject nsExec's documented launch error, keeping the production
        # fallback, environment passing, status handling and stack restoration.
        $hooks = $hooks -replace '(?m)^\s*nsExec::ExecToLog[^\r\n]*', "`n    Push `"error`""
    }
    if ($Mode -eq 'both-launchers-fail') {
        $hooks = $hooks -replace '(?m)^\s*ExecWait[^\r\n]*', "`n      SetErrors"
    }
    [IO.File]::WriteAllText((Join-Path $directory 'installer-hooks.nsh'), $hooks, $utf8)
    [IO.File]::WriteAllText((Join-Path $directory 'test.nsi'), $template, $utf8)
    # Fixture checks the inherited target path; never invokes Stop-Process.
    $fixture = @'
if (-not $env:BELFRY_OPENCONSOLE_PATH.EndsWith("Belfry Test's & ()\OpenConsole.exe")) { exit 3 }
exit 0
'@
    [IO.File]::WriteAllText((Join-Path $directory 'stop-openconsole.ps1'), $fixture, $utf8)
    & $MakeNsis (Join-Path $directory 'test.nsi') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "NSIS compilation failed: $Mode" }
    $process = Start-Process (Join-Path $directory 'test-installer.exe') -Wait -PassThru
    if ($ExpectedExit -ne $process.ExitCode) {
        throw "$Mode expected exit $ExpectedExit, received $($process.ExitCode)"
    }
    Write-Host "PASS: $Mode"
}

try {
    Test-Launcher 'normal' 0
    Test-Launcher 'fallback' 0
    Test-Launcher 'both-launchers-fail' 1
} finally {
    # This run owns the temporary directory and all of its test artifacts.
    if ([IO.Directory]::Exists($root)) { [IO.Directory]::Delete($root, $true) }
}
