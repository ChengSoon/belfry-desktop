$ErrorActionPreference = 'Stop'
$lockTimeoutSeconds = 5
$lockPollMilliseconds = 100

function Stop-BelfryConsole($Process, [string] $Target) {
    try {
        $path = $Process.Path
        if ([string]::IsNullOrEmpty($path)) { return }
        if (-not [string]::Equals(
            [IO.Path]::GetFullPath($path), $Target, [StringComparison]::OrdinalIgnoreCase
        )) { return }
    } catch {
        # An unreadable path must never fall back to terminating by name.
        return
    }

    try {
        Stop-Process -InputObject $Process -Force -ErrorAction Stop
    } catch {
        # The process can exit between enumeration and termination.
        if (-not $Process.HasExited) { throw }
    }
}

function Wait-BelfryConsoleFile([string] $Target, [datetime] $Deadline) {
    $sharing = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    while ($true) {
        try {
            # Open the existing file without truncating it or writing any bytes.
            $file = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::Write, $sharing)
            $file.Dispose()
            return
        } catch [IO.FileNotFoundException] {
            return
        } catch [IO.DirectoryNotFoundException] {
            return
        } catch [IO.IOException] {
            if ([datetime]::UtcNow -ge $Deadline) { throw }
            Start-Sleep -Milliseconds $lockPollMilliseconds
        }
    }
}

try {
    $targetPath = $env:BELFRY_OPENCONSOLE_PATH
    if ([string]::IsNullOrWhiteSpace($targetPath) -or -not [IO.Path]::IsPathRooted($targetPath)) {
        throw 'The console host path must be absolute.'
    }
    $targetPath = [IO.Path]::GetFullPath($targetPath)
    foreach ($process in @(Get-Process -Name OpenConsole -ErrorAction SilentlyContinue)) {
        Stop-BelfryConsole -Process $process -Target $targetPath
    }
    Wait-BelfryConsoleFile -Target $targetPath -Deadline ([datetime]::UtcNow.AddSeconds($lockTimeoutSeconds))
    exit 0
} catch {
    Write-Output "Unable to release Belfry console host: $($_.Exception.Message)"
    exit 1
}
