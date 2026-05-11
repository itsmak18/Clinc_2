# MediCore local dev launcher
# Run from repo root: .\start-dev.ps1

$root = $PSScriptRoot

# Load .env
Get-Content "$root\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
    }
}

# Backend needs PORT=5000, frontend needs PORT=5173
$backendEnv = @{
    DATABASE_URL   = $env:DATABASE_URL
    PORT           = "5000"
    NODE_ENV       = $env:NODE_ENV
    SESSION_SECRET = $env:SESSION_SECRET
    BCRYPT_ROUNDS  = $env:BCRYPT_ROUNDS
    CLINIC_TZ      = $env:CLINIC_TZ
}

$frontendEnv = @{
    DATABASE_URL   = $env:DATABASE_URL
    PORT           = "5173"
    BASE_PATH      = "/"
    NODE_ENV       = $env:NODE_ENV
    SESSION_SECRET = $env:SESSION_SECRET
}

# Build env strings for each window
$backendEnvStr  = ($backendEnv.GetEnumerator()  | ForEach-Object { "`$env:$($_.Key) = '$($_.Value)'" }) -join "; "
$frontendEnvStr = ($frontendEnv.GetEnumerator() | ForEach-Object { "`$env:$($_.Key) = '$($_.Value)'" }) -join "; "

$pnpmRoot = "Set-Location '$root'"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "$pnpmRoot; $backendEnvStr; pnpm --filter @workspace/api-server run dev" -WindowStyle Normal
Start-Process powershell -ArgumentList "-NoExit", "-Command", "$pnpmRoot; $frontendEnvStr; pnpm --filter @workspace/clinic run dev" -WindowStyle Normal

Write-Host ""
Write-Host "  MediCore starting..." -ForegroundColor Cyan
Write-Host "  Backend  -> http://localhost:5000" -ForegroundColor Green
Write-Host "  Frontend -> http://localhost:5173" -ForegroundColor Green
Write-Host ""
Write-Host "  Two new PowerShell windows opened (one per server)." -ForegroundColor Gray
Write-Host "  Close them to stop the servers." -ForegroundColor Gray
