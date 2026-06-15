[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipBundle
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $repoRoot "src-tauri"
$codexRuntimeJson = & node (Join-Path $repoRoot "scripts\codex-runtime-discovery.cjs")
if ($LASTEXITCODE -ne 0) {
    throw "Codex runtime discovery failed"
}
$codexRuntime = $codexRuntimeJson | ConvertFrom-Json
$codexPath = [string]$codexRuntime.path

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host "==> $Name"
    & $Action
    Write-Host "    PASS: $Name"
}

Write-Host "Codex runtime: $codexPath"
Write-Host "Codex source: $($codexRuntime.source)"
Write-Host "Codex version: $($codexRuntime.version)"
Write-Host "Codex discovery attempts: $($codexRuntime.attempts.Count)"

Push-Location $repoRoot
try {
    if (-not $SkipBuild) {
        Invoke-Step "cargo test" {
            Push-Location $tauriRoot
            try {
                cargo test
                if ($LASTEXITCODE -ne 0) {
                    throw "cargo test failed with exit code $LASTEXITCODE"
                }
            }
            finally {
                Pop-Location
            }
        }

        Invoke-Step "npm run build" {
            npm run build
            if ($LASTEXITCODE -ne 0) {
                throw "npm run build failed with exit code $LASTEXITCODE"
            }
        }

        if (-not $SkipBundle) {
            Invoke-Step "npm run tauri:build" {
                npm run tauri:build
                if ($LASTEXITCODE -ne 0) {
                    throw "npm run tauri:build failed with exit code $LASTEXITCODE"
                }
            }
        }
    }

    Invoke-Step "codex login status" {
        $status = (@(& $codexPath login status 2>&1) | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "codex login status failed with exit code $LASTEXITCODE"
        }
        if (-not ($status -match "Logged in")) {
            throw "Unexpected login status output: $status"
        }
        Write-Host "    $status"
    }

    Invoke-Step "codex debug models" {
        $rawModels = & $codexPath debug models
        if ($LASTEXITCODE -ne 0) {
            throw "codex debug models failed with exit code $LASTEXITCODE"
        }
        $models = $rawModels | ConvertFrom-Json
        if (-not $models.models -or $models.models.Count -lt 1) {
            throw "codex debug models returned no models"
        }
        Write-Host "    Models: $($models.models.Count)"
        Write-Host "    First model: $($models.models[0].slug)"
    }

    Invoke-Step "codex live rate limits" {
        $rawRateLimits = @(
            & node (Join-Path $repoRoot "scripts\app-server-rate-limits.cjs") $codexPath 2>&1
        )
        if ($LASTEXITCODE -ne 0) {
            throw "live rate limit probe failed with exit code $LASTEXITCODE`n$($rawRateLimits -join "`n")"
        }

        $rateLimits = ($rawRateLimits -join "`n") | ConvertFrom-Json
        if (-not $rateLimits.rateLimits) {
            throw "rate limit probe returned no rateLimits payload"
        }

        $primaryUsed = $rateLimits.rateLimits.primary.usedPercent
        $secondaryUsed = $rateLimits.rateLimits.secondary.usedPercent
        if ($null -eq $primaryUsed -or $null -eq $secondaryUsed) {
            throw "rate limit probe returned incomplete primary/secondary usage values"
        }

        $primaryRemaining = [Math]::Max(0, 100 - [int]$primaryUsed)
        $secondaryRemaining = [Math]::Max(0, 100 - [int]$secondaryUsed)
        Write-Host "    5-hour remaining: $primaryRemaining%"
        Write-Host "    Weekly remaining: $secondaryRemaining%"
    }

    Invoke-Step "codex app-server approval smoke" {
        $probeWorkspace = Join-Path $env:USERPROFILE "AxiOwl\approval-on-request-probe"
        $nestedDir = Join-Path $probeWorkspace "nested-dir"
        $logDir = Join-Path $repoRoot "output\app-server-probe"
        $logPath = Join-Path $logDir "smoke.log"

        New-Item -ItemType Directory -Force -Path $nestedDir | Out-Null
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        Set-Content -Path (Join-Path $nestedDir "proof.txt") -Value "delete me"

        $probeOutput = @(
            & node `
                (Join-Path $repoRoot "scripts\app-server-probe.cjs") `
                --workspace $probeWorkspace `
                --decision accept `
                --timeoutMs 120000 2>&1
        )
        if ($LASTEXITCODE -ne 0) {
            throw "app-server probe failed with exit code $LASTEXITCODE"
        }

        $probeOutput | Set-Content -Path $logPath
        $joined = ($probeOutput -join "`n")

        if ($joined -notmatch "SERVER item/commandExecution/requestApproval") {
            throw "app-server smoke did not request command approval"
        }
        if ($joined -notmatch "CLIENT_RESPONSE item/commandExecution/requestApproval \{""decision"":""accept""\}") {
            throw "app-server smoke did not send approval acceptance"
        }
        if ($joined -notmatch "SERVER turn/completed") {
            throw "app-server smoke did not reach turn completion"
        }
        if (Test-Path -LiteralPath $nestedDir) {
            throw "app-server smoke did not execute the approved remove command"
        }

        Write-Host "    Approval request observed"
        Write-Host "    Approval response accepted"
        Write-Host "    Turn completed"
    }

    Write-Host ""
    Write-Host "MVP smoke checks passed."
}
finally {
    Pop-Location
}
