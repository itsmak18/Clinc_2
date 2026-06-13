# gen-secrets.ps1 — generate the ./secrets/* files docker-compose.prod.yml expects.
# Idempotent: only creates files that don't already exist (never overwrites — so it
# won't clobber keys you've escrowed). Run from repo root:  .\scripts\gen-secrets.ps1
#
# Uses Node for crypto (always present) so it works on Windows without openssl.
# Generates: postgres_password, app_db_password, redis_password, session_secret,
# field_encryption_key, metrics_token, grafana_password, smtp_auth_password,
# jwt_private_key + jwt_public_key (matched Ed25519 pair), backup_ssh_key.
#
# ⚠ field_encryption_key + jwt_private_key are PHI-loss-critical — escrow them
#   (see SECURITY.md / docs/BACKUP_KEY_MANAGEMENT.md) before any real-PHI boot.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$secrets = Join-Path $root "secrets"
New-Item -ItemType Directory -Force $secrets | Out-Null

function New-Secret($name, [scriptblock]$gen) {
  $path = Join-Path $secrets $name
  if (Test-Path $path) { Write-Host "skip  $name (exists)"; return }
  & $gen $path
  Write-Host "wrote $name"
}

# base64/hex random via Node (no trailing newline)
$randB64 = { param($p) node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))" | Out-File -FilePath $p -Encoding ascii -NoNewline }
$randHex = { param($p) node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | Out-File -FilePath $p -Encoding ascii -NoNewline }

New-Secret "postgres_password"     $randB64
New-Secret "app_db_password"       $randB64
New-Secret "redis_password"        $randB64
New-Secret "session_secret"        $randHex
New-Secret "field_encryption_key"  $randHex
New-Secret "metrics_token"         $randHex
New-Secret "grafana_password"      $randB64
New-Secret "smtp_auth_password"    $randB64   # replace with your real SMTP app-token for delivery

# Ed25519 JWT pair — generated atomically so they always match.
$jwtPriv = Join-Path $secrets "jwt_private_key"
$jwtPub  = Join-Path $secrets "jwt_public_key"
if ((Test-Path $jwtPriv) -or (Test-Path $jwtPub)) {
  Write-Host "skip  jwt_private_key/jwt_public_key (one exists)"
} else {
  node -e "const c=require('crypto');const kp=c.generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});require('fs').writeFileSync(process.argv[1],kp.privateKey);require('fs').writeFileSync(process.argv[2],kp.publicKey)" $jwtPriv $jwtPub
  Write-Host "wrote jwt_private_key + jwt_public_key"
}

# Offsite backup SSH key (only needed if you run the backup container).
$sshKey = Join-Path $secrets "backup_ssh_key"
if (Test-Path $sshKey) {
  Write-Host "skip  backup_ssh_key (exists)"
} elseif (Get-Command ssh-keygen -ErrorAction SilentlyContinue) {
  ssh-keygen -t ed25519 -N '""' -f $sshKey -q
  Write-Host "wrote backup_ssh_key (+ .pub) — add .pub to the offsite host's authorized_keys"
} else {
  Write-Host "skip  backup_ssh_key (ssh-keygen not found; only needed for the backup container)"
}

Write-Host ""
Write-Host "Done. Secrets in $secrets. For a LOCAL rehearsal you do NOT need real GPG/SSH"
Write-Host "unless you start the 'backup' service. Next: create .env (see Tier 3 steps)."
