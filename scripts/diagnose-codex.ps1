# Run in both a Belfry PowerShell terminal and an external PowerShell terminal.
# Read-only: no API requests, configuration writes, auth.json, or conversation output.
[CmdletBinding()]
param([ValidateRange(1, 20)][int]$RecentSessions = 5)

$ErrorActionPreference = 'Stop'
$homePath = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    Join-Path $HOME '.codex'
} else { $env:CODEX_HOME }

$commands = @(Get-Command codex -All -ErrorAction SilentlyContinue)
$version = $null
if ($commands.Count -gt 0) {
    try { $version = (& $commands[0].Source --version 2>&1 | Out-String).Trim() }
    catch { $version = 'Version command failed' }
}

# Output only an explicit allowlist, never raw TOML or credentials.
$config = @()
$configPath = Join-Path $homePath 'config.toml'
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    $section = 'root'
    foreach ($line in [System.IO.File]::ReadLines($configPath)) {
        if ($line -match '^\s*\[(model_providers\.[A-Za-z0-9_-]+|features)\]\s*$') {
            $section = $Matches[1]
        } elseif ($line -match '^\s*\[') {
            $section = 'other'
        } elseif ($section -ne 'other' -and $line -match '^\s*(model|model_provider|wire_api|requires_openai_auth|supports_websockets|responses_websockets|responses_websockets_v2)\s*=\s*("[A-Za-z0-9_.:/-]+"|true|false)\s*(?:#.*)?$') {
            $config += [pscustomobject]@{
                section = $section
                key = $Matches[1]
                value = $Matches[2]
            }
        }
    }
}

# Inspect just the first eight lines of each recent rollout for session_meta.
# Explicitly omit instructions, user messages, reasoning, and tool output.
$sessions = @()
$sessionsPath = Join-Path $homePath 'sessions'
if (Test-Path -LiteralPath $sessionsPath -PathType Container) {
    $files = @(Get-ChildItem -LiteralPath $sessionsPath -Filter '*.jsonl' -File -Recurse |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First $RecentSessions)
    foreach ($file in $files) {
        $count = 0
        $meta = $null
        foreach ($line in [System.IO.File]::ReadLines($file.FullName)) {
            $count++
            try {
                $record = ConvertFrom-Json -InputObject $line
                if ($record.type -eq 'session_meta') {
                    $meta = $record.payload
                    break
                }
            } catch { # A partial or invalid JSONL line should not stop the report.
            }
            if ($count -ge 8) { break }
        }
        $sessions += [pscustomobject]@{
            file = $file.Name
            modifiedUtc = $file.LastWriteTimeUtc.ToString('o')
            sessionId = if ($meta.session_id -is [string]) { $meta.session_id } elseif ($meta.id -is [string]) { $meta.id } else { $null }
            modelProvider = if ($meta.model_provider -is [string]) { $meta.model_provider } else { $null }
            cliVersion = if ($meta.cli_version -is [string]) { $meta.cli_version } else { $null }
        }
    }
}

[pscustomobject]@{
    codexPaths = @($commands | ForEach-Object { $_.Source })
    codexVersion = $version
    codexHome = $homePath
    belfrySession = -not [string]::IsNullOrWhiteSpace($env:BELFRY_TAB_ID)
    config = $config
    recentSessions = $sessions
} | ConvertTo-Json -Depth 6
