param(
    [string] $CleanupScript = (Join-Path $PSScriptRoot '../src-tauri/windows/stop-openconsole.ps1')
)

$ErrorActionPreference = 'Stop'
$script:Failures = 0
$script:Cases = 0
$fixture = @{ Processes = @(); StoppedIds = @() }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('belfry-installer-test-' + [guid]::NewGuid())
$target = Join-Path $testRoot "Belfry Test's & `$()/OpenConsole.exe"
$previousTarget = $env:BELFRY_OPENCONSOLE_PATH

function Assert-Equal($Expected, $Actual, [string] $Message) {
    if ($Expected -cne $Actual) {
        throw "$Message (expected: $Expected; actual: $Actual)"
    }
}

function Test-Case([string] $Name, [scriptblock] $Body) {
    $script:Cases++
    $fixture.Processes = @()
    $fixture.StoppedIds = @()
    try {
        & $Body
        Write-Host "PASS: $Name"
    } catch {
        $script:Failures++
        Write-Host "FAIL: $Name -- $_"
    }
}

function New-TestProcess([int] $Id, [string] $Path) {
    [pscustomobject]@{ Id = $Id; Path = $Path; HasExited = $false; StopError = $null }
}

# Mock only process enumeration/termination; no real application is stopped.
function Get-Process {
    [CmdletBinding()]
    param([string] $Name)
    Assert-Equal 'OpenConsole' $Name 'Cleanup must enumerate only console hosts'
    $fixture.Processes
}

function Stop-Process {
    [CmdletBinding()]
    param([Parameter(ValueFromPipeline = $true)] $InputObject, [switch] $Force)
    process {
        Assert-Equal $true $Force.IsPresent 'Cleanup must terminate the matched host'
        $fixture.StoppedIds += $InputObject.Id
        if ($InputObject.StopError) {
            Write-Error $InputObject.StopError
            return
        }
        $InputObject.HasExited = $true
    }
}

function Invoke-Cleanup([string] $TargetPath) {
    $env:BELFRY_OPENCONSOLE_PATH = $TargetPath
    $global:LASTEXITCODE = 0
    & $CleanupScript | Out-Host
    return $global:LASTEXITCODE
}

Add-Type -TypeDefinition @'
public static class BelfryInstallerTestLock {
    public static async System.Threading.Tasks.Task ReleaseAfter(
        System.IO.FileStream file, int milliseconds) {
        await System.Threading.Tasks.Task.Delay(milliseconds);
        file.Dispose();
    }
}
'@

try {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    [IO.File]::WriteAllText($target, 'original runtime')

    Test-Case 'fresh installation without a console host or existing file' {
        Assert-Equal 0 (Invoke-Cleanup (Join-Path $testRoot 'missing/OpenConsole.exe')) 'Exit code'
        Assert-Equal 0 $fixture.StoppedIds.Count 'No process should be stopped'
    }

    Test-Case 'matches full normalized paths and preserves other installations' {
        $fixture.Processes = @(
            (New-TestProcess 101 $target),
            (New-TestProcess 102 $target.ToUpperInvariant()),
            (New-TestProcess 103 (Join-Path $testRoot 'other/OpenConsole.exe')),
            (New-TestProcess 104 (Join-Path ([IO.Path]::GetDirectoryName($target)) './OpenConsole.exe'))
        )
        Assert-Equal 0 (Invoke-Cleanup $target) 'Exit code'
        Assert-Equal '101,102,104' ($fixture.StoppedIds -join ',') 'Only this installation may be stopped'
        Assert-Equal 'original runtime' ([IO.File]::ReadAllText($target)) 'Probe must not alter the file'
    }

    Test-Case 'unreadable process paths never cause name-only termination' {
        $unreadable = New-TestProcess 202 $null
        $unreadable | Add-Member -Force -MemberType ScriptProperty -Name Path -Value { throw 'Access denied' }
        $fixture.Processes = @((New-TestProcess 201 $null), $unreadable)
        Assert-Equal 0 (Invoke-Cleanup $target) 'Exit code'
        Assert-Equal 0 $fixture.StoppedIds.Count 'Unknown processes must be preserved'
    }

    Test-Case 'a process that exits during termination is harmless' {
        $process = New-TestProcess 301 $target
        $process.HasExited = $true
        $process.StopError = 'Process already exited'
        $fixture.Processes = @($process)
        Assert-Equal 0 (Invoke-Cleanup $target) 'Exit code'
    }

    Test-Case 'termination failure is reported instead of silently succeeding' {
        $process = New-TestProcess 401 $target
        $process.StopError = 'Access denied'
        $fixture.Processes = @($process)
        Assert-Equal 1 (Invoke-Cleanup $target) 'A live process that cannot be stopped must fail'
    }

    Test-Case 'waits for the actual executable lock to be released' {
        $locked = [IO.File]::Open($target, 'Open', 'ReadWrite', 'None')
        try {
            $release = [BelfryInstallerTestLock]::ReleaseAfter($locked, 400)
            Assert-Equal 0 (Invoke-Cleanup $target) 'Exit code'
            Assert-Equal $true $release.IsCompleted 'Installation must wait for the file lock'
        } finally {
            $locked.Dispose()
            if ($release) { $release.GetAwaiter().GetResult() | Out-Null }
        }
    }

    Test-Case 'a persistent file lock returns an error within the timeout' {
        $locked = [IO.File]::Open($target, 'Open', 'ReadWrite', 'None')
        try {
            Assert-Equal 1 (Invoke-Cleanup $target) 'A locked executable must not be overwritten'
        } finally {
            $locked.Dispose()
        }
    }

    Test-Case 'missing target path fails before touching any process' {
        $fixture.Processes = @((New-TestProcess 501 $target))
        Assert-Equal 1 (Invoke-Cleanup '') 'Missing target must fail'
        Assert-Equal 0 $fixture.StoppedIds.Count 'No process should be stopped'
    }

    Test-Case 'relative target path fails before touching any process' {
        $fixture.Processes = @((New-TestProcess 601 $target))
        Assert-Equal 1 (Invoke-Cleanup 'OpenConsole.exe') 'Relative target must fail'
        Assert-Equal 0 $fixture.StoppedIds.Count 'No process should be stopped'
    }
} finally {
    $env:BELFRY_OPENCONSOLE_PATH = $previousTarget
    # The directory is created by this test run and contains only its fixtures.
    if ([IO.Directory]::Exists($testRoot)) { [IO.Directory]::Delete($testRoot, $true) }
}

Write-Host "$($script:Cases - $script:Failures)/$script:Cases cases passed"
if ($script:Failures -gt 0) { exit 1 }
exit 0
