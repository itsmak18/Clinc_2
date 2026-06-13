# dev-smoke.ps1 — runs the full developer smoke test suite for MediCore.
# Run from repo root:  .\scripts\dev-smoke.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if ($root -match "scripts$") {
    $root = Split-Path -Parent $root
}

# 1. Load .env
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
        }
    }
    Write-Host "Loaded environment variables from $envFile" -ForegroundColor Cyan
} else {
    Write-Host ".env file not found. Setting default database url." -ForegroundColor Yellow
    $env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/clinic_db"
}

# Ensure we have a valid DATABASE_URL
if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/clinic_db"
}

$dbAdminUrl = $env:DATABASE_URL -replace '/clinic_db$','/postgres'

function Run-Step([string]$name, [scriptblock]$action) {
    Write-Host "`n=== [STARTING] $name ===" -ForegroundColor Cyan
    try {
        & $action
        Write-Host "=== [SUCCESS] $name ===" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "=== [FAILURE] $name ===" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        return $false
    }
}

$results = [ordered]@{}

# Step 1: Recreate and Seed dev DB
$results["Recreate & Seed dev DB"] = Run-Step "Recreate & Seed dev DB" {
    Write-Host "Recreating database 'clinic_db' using admin URL..." -ForegroundColor Gray
    psql $dbAdminUrl -c "DROP DATABASE IF EXISTS clinic_db WITH (FORCE);" -c "CREATE DATABASE clinic_db;"
    
    Write-Host "Running migrations..." -ForegroundColor Gray
    pnpm --filter @workspace/db run db:migrate
    
    Write-Host "Seeding database..." -ForegroundColor Gray
    pnpm --filter @workspace/scripts run seed
}

# Step 2: Run Unit Tests
$results["API Unit Tests"] = Run-Step "API Unit Tests" {
    $origEnv = $env:NODE_ENV
    $env:NODE_ENV = "test"
    try {
        pnpm --filter @workspace/api-server run test
    } finally {
        $env:NODE_ENV = $origEnv
    }
}

$results["Frontend Unit Tests"] = Run-Step "Frontend Unit Tests" {
    $origEnv = $env:NODE_ENV
    $env:NODE_ENV = "test"
    try {
        pnpm --filter @workspace/clinic run test
    } finally {
        $env:NODE_ENV = $origEnv
    }
}

# Step 3: Run DB Integration Tests
$results["DB Integration Tests"] = Run-Step "DB Integration Tests" {
    $origEnv = $env:NODE_ENV
    $env:NODE_ENV = "test"
    $env:INTEGRATION_PG_ADMIN_URL = $dbAdminUrl
    try {
        pnpm --filter @workspace/api-server run test:integration-db
    } finally {
        $env:NODE_ENV = $origEnv
    }
}

# Step 4: Run Restore Drill
$results["Restore Drill"] = Run-Step "Restore Drill" {
    Write-Host "Recreating temporary databases for drill..." -ForegroundColor Gray
    psql $dbAdminUrl -c "DROP DATABASE IF EXISTS clinic_db_source WITH (FORCE);" -c "CREATE DATABASE clinic_db_source;" -c "DROP DATABASE IF EXISTS clinic_db_target WITH (FORCE);" -c "CREATE DATABASE clinic_db_target;"
    
    $origDbUrl = $env:DATABASE_URL
    Write-Host "Migrating source database..." -ForegroundColor Gray
    $env:DATABASE_URL = $origDbUrl -replace '/clinic_db$','/clinic_db_source'
    pnpm --filter @workspace/db run db:migrate
    
    Write-Host "Seeding source database..." -ForegroundColor Gray
    pnpm --filter @workspace/scripts run seed
    
    Write-Host "Running backup-verify script restore drill..." -ForegroundColor Gray
    $env:RESTORE_DATABASE_URL = $origDbUrl -replace '/clinic_db$','/clinic_db_target'
    $env:BACKUP_STORAGE_PATH = Join-Path $root "backups"
    node scripts/backup-verify.mjs --restore
    
    # Restore env DATABASE_URL back
    $env:DATABASE_URL = $origDbUrl
}

# Restore DATABASE_URL back to main dev DB
$env:DATABASE_URL = $dbAdminUrl -replace '/postgres$','/clinic_db'

# Step 5: Check optional tools (k6, promtool, amtool)
Write-Host "`n=== Checking optional tools ===" -ForegroundColor Cyan

if (Get-Command k6 -ErrorAction SilentlyContinue) {
    Write-Host "[k6] Found. To run load tests: k6 run scripts/load-test.js" -ForegroundColor Green
} else {
    Write-Host "[k6] Not found. Download it to run load tests: k6 run scripts/load-test.js" -ForegroundColor Yellow
}

if (Get-Command promtool -ErrorAction SilentlyContinue) {
    Write-Host "[promtool] Found. To check alerts: promtool check rules prometheus-alerts.yml" -ForegroundColor Green
} else {
    Write-Host "[promtool] Not found. Download it to run rule checks: promtool check rules prometheus-alerts.yml" -ForegroundColor Yellow
}

if (Get-Command amtool -ErrorAction SilentlyContinue) {
    Write-Host "[amtool] Found. To check config: amtool check-config monitoring/alertmanager/alertmanager.yml" -ForegroundColor Green
} else {
    Write-Host "[amtool] Not found. Download it to check alertmanager config: amtool check-config monitoring/alertmanager/alertmanager.yml" -ForegroundColor Yellow
}

# Print Summary Table
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "          SMOKE TEST RUN SUMMARY          " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
$failedCount = 0
foreach ($key in $results.Keys) {
    $val = $results[$key]
    if ($val) {
        Write-Host "  [PASS] $key" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $key" -ForegroundColor Red
        $failedCount++
    }
}
Write-Host "==========================================" -ForegroundColor Cyan

if ($failedCount -eq 0) {
    Write-Host "All core steps successfully verified! Ready for deployment rehearsal." -ForegroundColor Green
    exit 0
} else {
    Write-Host "$failedCount check(s) failed. Please review errors above." -ForegroundColor Red
    exit 1
}
