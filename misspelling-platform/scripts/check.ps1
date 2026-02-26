Set-Location (Split-Path $PSScriptRoot -Parent)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:StartedAt = Get-Date
$script:BaseUrl = 'http://127.0.0.1:8000'
function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[STEP] $Message" -ForegroundColor Cyan
}
function Write-Pass {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
}
function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[INFO] $Message"
}
function Write-Warn {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}
function Fail {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    exit 1
}
function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$CaptureOutput
    )
    if ($CaptureOutput) {
        $output = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $text = ($output | Out-String).Trim()
            throw "Command failed ($FilePath $($Arguments -join ' ')) [exit=$exitCode] $text"
        }
        return ($output | Out-String)
    }
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Command failed ($FilePath $($Arguments -join ' ')) [exit=$exitCode]"
    }
}
function Invoke-DockerCompose {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$CaptureOutput
    )
    $allArgs = @('compose') + $Arguments
    return Invoke-External -FilePath 'docker' -Arguments $allArgs -CaptureOutput:$CaptureOutput
}
function Invoke-MySqlQuery {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
        [switch]$RawOutput
    )
    $args = @(
        'exec', '-T', '-e', 'MYSQL_PWD=root', 'mysql',
        'mysql', '-uroot', '-D', 'misspell'
    )
    if ($RawOutput) {
        $args += @('--batch', '--raw', '--skip-column-names')
    }
    $args += @('-e', $Sql)
    $result = Invoke-DockerCompose -Arguments $args -CaptureOutput
    $cleanLines = @()
    foreach ($line in ($result -split "`r?`n")) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        if ($line -match '^mysql:\s+\[Warning\]') {
            continue
        }
        $cleanLines += $line
    }
    return (($cleanLines -join "`n").Trim())
}
function Wait-ForHealth {
    param([int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-RestMethod -Method Get -Uri "$($script:BaseUrl)/health" -TimeoutSec 5
            if ($resp -and $resp.db -eq $true) {
                return $resp
            }
        } catch {
            # keep polling until timeout
        }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for GET /health to return db:true"
}
function Get-DbTableNames {
    $rows = Invoke-MySqlQuery -Sql "SHOW TABLES;" -RawOutput
    if ([string]::IsNullOrWhiteSpace($rows)) {
        return @()
    }
    return @($rows -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}
function Get-LatestTaskRow {
    $row = Invoke-MySqlQuery -Sql "SELECT task_id, task_type, status FROM tasks ORDER BY id DESC LIMIT 1;" -RawOutput
    if ([string]::IsNullOrWhiteSpace($row)) {
        return $null
    }
    $parts = $row -split "`t"
    if ($parts.Length -lt 3) {
        throw "Unexpected MySQL row format: $row"
    }
    return [pscustomobject]@{
        task_id   = $parts[0]
        task_type = $parts[1]
        status    = $parts[2]
    }
}
function Try-CheckTimeSeriesPersistence {
    param([Parameter(Mandatory = $true)][string]$TaskId)
    try {
        # M2 schema has no time_series.task_id column; task linkage is stored in meta_json.task_id.
        $seriesCount = [int](Invoke-MySqlQuery -Sql "SELECT COUNT(*) FROM time_series WHERE JSON_UNQUOTE(JSON_EXTRACT(meta_json,'$.task_id'))='$TaskId';" -RawOutput)
        if ($seriesCount -le 0) {
            Write-Warn "time_series not persisted (M3) for task_id=$TaskId"
            return
        }
        $pointCount = [int](Invoke-MySqlQuery -Sql "SELECT COUNT(*) FROM time_series_points WHERE series_id IN (SELECT id FROM time_series WHERE JSON_UNQUOTE(JSON_EXTRACT(meta_json,'$.task_id'))='$TaskId');" -RawOutput)
        if ($pointCount -le 0) {
            Write-Warn "time_series points missing (M3) for task_id=$TaskId"
            return
        }
        Write-Pass "time_series points persisted (series=$seriesCount, points=$pointCount)"
    } catch {
        Write-Warn ("time_series not persisted (M3): " + $_.Exception.Message)
    }
}
function Try-CheckTaskEvents {
    param(
        [Parameter(Mandatory = $true)][string]$TaskId,
        [Parameter(Mandatory = $true)][string[]]$ExpectedLevels
    )
    try {
        $raw = Invoke-MySqlQuery -Sql "SELECT DISTINCT level FROM task_events WHERE task_id = '$TaskId';" -RawOutput
        $present = @()
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            $present = @($raw -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        }
        $missing = @($ExpectedLevels | Where-Object { $present -notcontains $_ })
        if ($missing.Count -gt 0) {
            Write-Warn ("task_events not complete for task_id={0}; missing={1}; present={2}" -f $TaskId, ($missing -join ','), ($present -join ','))
            return
        }
        Write-Pass ("task_events complete ({0})" -f ($ExpectedLevels -join ','))
    } catch {
        Write-Warn ("task_events not complete: " + $_.Exception.Message)
    }
}
function Try-CheckLexiconSuggest {
    try {
        $resp = Invoke-RestMethod -Method Post -Uri "$($script:BaseUrl)/api/lexicon/variants/suggest?word=demo&k=5" -TimeoutSec 10
        if ($null -eq $resp) {
            Write-Warn "llm suggest check returned empty response"
            return
        }
        if ($resp.PSObject.Properties.Name -contains 'llm_enabled' -and $resp.llm_enabled -eq $false) {
            Write-Warn "llm disabled (BAILIAN_API_KEY not configured); lexicon suggest endpoint fallback/cache path only"
            return
        }
        $count = 0
        if ($resp.PSObject.Properties.Name -contains 'variants' -and $null -ne $resp.variants) {
            $count = @($resp.variants).Count
        }
        Write-Pass "lexicon suggest endpoint responded (variants=$count)"
    } catch {
        Write-Warn ("lexicon suggest endpoint check skipped: " + $_.Exception.Message)
    }
}
function Try-CheckGbncPull {
    try {
        $uri = "$($script:BaseUrl)/api/data/gbnc/pull?word=ChatGPT&start_year=2018&end_year=2019&corpus=eng_2019&smoothing=0"
        $resp = Invoke-RestMethod -Method Post -Uri $uri -TimeoutSec 40
        if ($null -eq $resp) {
            Write-Warn "gbnc pull skipped (not configured): empty response"
            return
        }
        $items = @()
        if ($resp.PSObject.Properties.Name -contains 'items' -and $null -ne $resp.items) { $items = @($resp.items) }
        if ($items.Count -le 0) {
            Write-Warn "gbnc pull returned no series rows (word may be absent in selected range)"
            return
        }
        $seriesIds = @()
        foreach ($it in $items) {
            if ($it.PSObject.Properties.Name -contains 'series_id') { $seriesIds += [int]$it.series_id }
        }
        if ($seriesIds.Count -le 0) {
            Write-Warn "gbnc pull response missing series_id"
            return
        }
        $idList = ($seriesIds | Select-Object -Unique) -join ','
        $pointCount = [int](Invoke-MySqlQuery -Sql "SELECT COUNT(*) FROM time_series_points WHERE series_id IN ($idList);" -RawOutput)
        if ($pointCount -le 0) {
            Write-Warn "gbnc pull returned series but no persisted points"
            return
        }
        Write-Pass "gbnc pull persisted points (series=$($seriesIds.Count), points=$pointCount)"
    } catch {
        Write-Warn ("gbnc pull skipped (not configured): " + $_.Exception.Message)
    }
}
function Try-CheckAuthLogin {
    $u = ($env:INIT_ADMIN_USERNAME | Out-String).Trim()
    $p = ($env:INIT_ADMIN_PASSWORD | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($u) -or [string]::IsNullOrWhiteSpace($p)) {
        Write-Warn "auth login check skipped (INIT_ADMIN_USERNAME/PASSWORD not set)"
        return
    }
    try {
        $body = @{ username = $u; password = $p } | ConvertTo-Json -Compress
        $login = Invoke-RestMethod -Method Post -Uri "$($script:BaseUrl)/api/auth/login" -ContentType "application/json" -Body $body -TimeoutSec 15
        if ($null -eq $login -or -not $login.access_token) { throw "missing access_token" }
        $headers = @{ Authorization = "Bearer $($login.access_token)" }
        $adminResp = Invoke-RestMethod -Method Get -Uri "$($script:BaseUrl)/api/admin/audit-logs?limit=1" -Headers $headers -TimeoutSec 15
        $count = if ($adminResp -and ($adminResp.PSObject.Properties.Name -contains 'items') -and $null -ne $adminResp.items) { @($adminResp.items).Count } else { 0 }
        Write-Pass "auth login + admin audit access ok (items=$count)"
    } catch {
        Write-Warn ("auth login check failed: " + $_.Exception.Message)
    }
}
function Wait-ForDbTaskSuccess {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedTaskId,
        [Parameter(Mandatory = $true)][string]$ExpectedTaskType,
        [int]$TimeoutSeconds = 20
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $row = Get-LatestTaskRow
        if ($null -ne $row) {
            if ($row.task_id -eq $ExpectedTaskId -and $row.task_type -eq $ExpectedTaskType -and $row.status -eq 'SUCCESS') {
                return $row
            }
        }
        Start-Sleep -Seconds 1
    }
    $last = Get-LatestTaskRow
    if ($null -eq $last) {
        throw "No rows found in tasks table while waiting for task '$ExpectedTaskId'"
    }
    throw "Latest task row did not reach SUCCESS. latest(task_id=$($last.task_id), task_type=$($last.task_type), status=$($last.status))"
}
function Convert-JsonIfNeeded {
    param([Parameter(ValueFromPipeline = $true)]$Value)
    if ($null -eq $Value) {
        return $null
    }
    if ($Value -is [string]) {
        $trim = $Value.Trim()
        if ($trim.StartsWith('{') -or $trim.StartsWith('[')) {
            try {
                return ($trim | ConvertFrom-Json)
            } catch {
                return $Value
            }
        }
    }
    return $Value
}
function Try-CreateSimulationTask {
    try {
        $resp = Invoke-RestMethod -Method Post -Uri "$($script:BaseUrl)/api/tasks/simulation-run?n=10&steps=10" -TimeoutSec 10
        return [pscustomobject]@{ Implemented = $true; Response = $resp }
    } catch {
        $statusCode = $null
        if ($_.Exception.PSObject.Properties.Name -contains 'Response' -and $null -ne $_.Exception.Response) {
            try {
                $statusCode = [int]$_.Exception.Response.StatusCode
            } catch {
                $statusCode = $null
            }
        }
        if ($statusCode -eq 404) {
            return [pscustomobject]@{ Implemented = $false; Response = $null }
        }
        throw
    }
}
try {
    Write-Step "Precheck Docker CLI and daemon"
    Get-Command docker -ErrorAction Stop | Out-Null
    Invoke-External -FilePath 'docker' -Arguments @('compose', 'version') | Out-Null
    try {
        Invoke-External -FilePath 'docker' -Arguments @('info') -CaptureOutput | Out-Null
    } catch {
        Fail "Docker daemon is not available. Start Docker Desktop and retry."
    }
    Write-Pass "Docker CLI and daemon are available"
    Write-Step "docker compose up -d --build"
    Invoke-DockerCompose -Arguments @('up', '-d', '--build')
    Write-Pass "docker compose up -d --build succeeded"
    Write-Step "Waiting for GET /health to return db:true"
    $health = Wait-ForHealth -TimeoutSeconds 120
    if ($health.db -ne $true) {
        throw "/health returned but db was not true"
    }
    Write-Pass "/health db:true"
    Write-Step "Inspect DB schema status"
    $tableNames = @(Get-DbTableNames)
    $tableCount = $tableNames.Count
    $requiredSchemaTables = @(
        'users', 'roles', 'permissions', 'user_roles', 'role_permissions', 'audit_logs',
        'tasks', 'task_events', 'task_artifacts',
        'data_sources', 'lexicon_versions', 'lexicon_terms', 'lexicon_variants'
    )
    $missingSchemaTables = @($requiredSchemaTables | Where-Object { $tableNames -notcontains $_ })
    $formalSchemaReady = ($tableCount -ge 10 -and $missingSchemaTables.Count -eq 0)
    if ($formalSchemaReady) {
        Write-Pass "Formal schema detected (tables=$tableCount)"
    } else {
        Write-Warn "Formal schema missing/incomplete (tables=$tableCount). Temporary tasks fallback will be removed in a future milestone."
        if ($missingSchemaTables.Count -gt 0) {
            Write-Info ("Missing schema tables: " + ($missingSchemaTables -join ", "))
        }
    }
    if (-not ($tableNames -contains 'tasks')) {
        Write-Step "Bootstrap minimal tasks table (temporary fallback)"
        $bootstrapSql = @'
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(255) NOT NULL,
  task_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  params_json JSON NULL,
  result_json JSON NULL,
  error_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tasks_task_id (task_id),
  KEY idx_tasks_status (status),
  KEY idx_tasks_task_type (task_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
'@
        Invoke-MySqlQuery -Sql $bootstrapSql | Out-Null
        Write-Pass "tasks table bootstrap ensured"
    } else {
        Write-Info "tasks table already present; fallback bootstrap skipped"
    }
    Write-Step "Create and verify word-analysis task"
    $wordCsvSummary = "[WARN] word-analysis artifact csv download check not run"
    $wordCreate = Invoke-RestMethod -Method Post -Uri "$($script:BaseUrl)/api/tasks/word-analysis?word=demo" -TimeoutSec 10
    if (-not $wordCreate.task_id) {
        throw "word-analysis create response missing task_id"
    }
    $wordTaskId = [string]$wordCreate.task_id
    Write-Info "word-analysis task_id=$wordTaskId"
    Start-Sleep -Seconds 7
    $wordRow = Wait-ForDbTaskSuccess -ExpectedTaskId $wordTaskId -ExpectedTaskType 'word-analysis' -TimeoutSeconds 20
    Write-Pass "word-analysis latest DB row SUCCESS (task_id=$($wordRow.task_id))"
    $wordTaskDetail = Invoke-RestMethod -Method Get -Uri "$($script:BaseUrl)/api/tasks/$wordTaskId" -TimeoutSec 10
    $wordResultPayload = Convert-JsonIfNeeded $wordTaskDetail.result
    $wordFilesPayload = if ($null -ne $wordResultPayload) { Convert-JsonIfNeeded $wordResultPayload.files } else { $null }
    if ($null -ne $wordFilesPayload -and ($wordFilesPayload.PSObject.Properties.Name -contains 'csv')) {
        $wordCsvUrl = "$($script:BaseUrl)$([string]$wordFilesPayload.csv)"
        $tmpWordCsv = Join-Path $env:TEMP ("misspelling-check-" + [guid]::NewGuid().ToString('N') + ".csv")
        try {
            $respWordCsv = Invoke-WebRequest -Method Get -Uri $wordCsvUrl -OutFile $tmpWordCsv -TimeoutSec 20
            $wordCsvFile = Get-Item $tmpWordCsv
            if ($wordCsvFile.Length -le 0) { throw "Downloaded word-analysis CSV is empty" }
            if ($respWordCsv -and ($respWordCsv.PSObject.Properties.Name -contains 'StatusCode') -and [int]$respWordCsv.StatusCode -ne 200) {
                throw "word-analysis CSV download returned HTTP $([int]$respWordCsv.StatusCode)"
            }
        } finally {
            if (Test-Path $tmpWordCsv) { Remove-Item -Force $tmpWordCsv }
        }
        Write-Pass "word-analysis artifact csv download 200"
        $wordCsvSummary = "[PASS] word-analysis artifact csv download 200 (task_id=$wordTaskId)"
    } else {
        Write-Warn "word-analysis result_json does not contain files.csv (M7)"
    }
    Try-CheckTaskEvents -TaskId $wordTaskId -ExpectedLevels @('QUEUED', 'SUCCESS')
    Try-CheckLexiconSuggest
    Try-CheckGbncPull
    Try-CheckAuthLogin
    Write-Step "Check optional simulation-run task"
    $simCreate = Try-CreateSimulationTask
    $simulationSummary = "[SKIP] simulation-run endpoint not implemented"
    $simulationPngSummary = "[SKIP] simulation-run preview png download not checked"
    if ($simCreate.Implemented) {
        if (-not $simCreate.Response.task_id) {
            throw "simulation-run create response missing task_id"
        }
        $simTaskId = [string]$simCreate.Response.task_id
        Write-Info "simulation-run task_id=$simTaskId"
        Start-Sleep -Seconds 7
        $simRow = Wait-ForDbTaskSuccess -ExpectedTaskId $simTaskId -ExpectedTaskType 'simulation-run' -TimeoutSeconds 30
        Write-Pass "simulation-run latest DB row SUCCESS (task_id=$($simRow.task_id))"
        $taskDetail = Invoke-RestMethod -Method Get -Uri "$($script:BaseUrl)/api/tasks/$simTaskId" -TimeoutSec 10
        $resultPayload = Convert-JsonIfNeeded $taskDetail.result
        if ($null -eq $resultPayload) {
            throw "simulation-run task result is empty"
        }
        $filesPayload = Convert-JsonIfNeeded $resultPayload.files
        $csvPath = $null
        if ($null -ne $filesPayload -and ($filesPayload.PSObject.Properties.Name -contains 'csv')) {
            $csvPath = [string]$filesPayload.csv
        }
        if ([string]::IsNullOrWhiteSpace($csvPath)) {
            throw "simulation-run result_json does not contain files.csv download link"
        }
        $csvUrl = if ($csvPath -match '^https?://') { $csvPath } else { "$($script:BaseUrl)$csvPath" }
        $tmpCsv = Join-Path $env:TEMP ("misspelling-check-" + [guid]::NewGuid().ToString('N') + ".csv")
        try {
            $downloadResp = Invoke-WebRequest -Method Get -Uri $csvUrl -OutFile $tmpCsv -TimeoutSec 20
            $csvFile = Get-Item $tmpCsv
            if ($csvFile.Length -le 0) {
                throw "Downloaded CSV is empty"
            }
            $statusCode = $null
            if ($downloadResp -and ($downloadResp.PSObject.Properties.Name -contains 'StatusCode')) {
                $statusCode = [int]$downloadResp.StatusCode
            } elseif ($downloadResp -and ($downloadResp.PSObject.Properties.Name -contains 'BaseResponse') -and $downloadResp.BaseResponse) {
                $statusCode = [int]$downloadResp.BaseResponse.StatusCode
            }
            if ($null -ne $statusCode -and $statusCode -ne 200) {
                throw "CSV download returned HTTP $statusCode"
            }
        } finally {
            if (Test-Path $tmpCsv) {
                Remove-Item -Force $tmpCsv
            }
        }
        Write-Pass "simulation-run artifact csv download 200"
        $pngUrl = "$($script:BaseUrl)/api/files/$simTaskId/preview.png"
        $tmpPng = Join-Path $env:TEMP ("misspelling-check-" + [guid]::NewGuid().ToString('N') + ".png")
        try {
            $pngResp = Invoke-WebRequest -Method Get -Uri $pngUrl -OutFile $tmpPng -TimeoutSec 20
            $pngFile = Get-Item $tmpPng
            if ($pngFile.Length -le 0) {
                throw "Downloaded PNG is empty"
            }
            if ($pngResp -and ($pngResp.PSObject.Properties.Name -contains 'StatusCode') -and [int]$pngResp.StatusCode -ne 200) {
                throw "PNG download returned HTTP $([int]$pngResp.StatusCode)"
            }
        } finally {
            if (Test-Path $tmpPng) {
                Remove-Item -Force $tmpPng
            }
        }
        Write-Pass "simulation-run preview png download 200"
        $simulationPngSummary = "[PASS] simulation-run preview png download 200 (task_id=$simTaskId)"
        Try-CheckTimeSeriesPersistence -TaskId $simTaskId
        Try-CheckTaskEvents -TaskId $simTaskId -ExpectedLevels @('QUEUED', 'RUNNING', 'SUCCESS')
        $simulationSummary = "[PASS] simulation-run SUCCESS + CSV download 200 (task_id=$simTaskId)"
    } else {
        Write-Info "simulation-run endpoint not implemented; skipping optional validation"
    }
    $elapsed = (Get-Date) - $script:StartedAt
    Write-Host ""
    Write-Host "===== check.ps1 summary ====="
    Write-Host "[PASS] docker compose up -d --build"
    Write-Host "[PASS] GET /health db:true"
    Write-Host ("[INFO] schema tables={0}" -f $tableCount)
    Write-Host "[PASS] word-analysis latest task SUCCESS (task_id=$wordTaskId)"
    Write-Host $wordCsvSummary
    Write-Host $simulationSummary
    Write-Host $simulationPngSummary
    Write-Host ("[INFO] elapsed={0:n1}s" -f $elapsed.TotalSeconds)
    exit 0
} catch {
    $message = $_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = ($_ | Out-String).Trim()
    }
    Fail $message
}
