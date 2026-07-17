# Derived from where this script lives — see deploy.ps1. Hardcoding the drive
# breaks every time the checkout moves.
$ProjectRoot = $PSScriptRoot

# Kill all existing node + cloudflared (the worker pool spawns child node
# processes that don't always die with the parent — wipe them all).
Get-Process -Name "node","cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 1

# Wait for port 3001 to actually free up — Stop-Process is async on Windows
# and the OS can hold the socket in TIME_WAIT for a few seconds. Retrying
# inside the server on bind-fail wastes 30+ seconds; doing it here is faster.
for ($i = 0; $i -lt 20; $i++) {
    $busy = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) { break }
    Start-Sleep -Milliseconds 500
}

# Start server (4 workers — i9-14900K 24-core, 128GB RAM)
$env:RACKTRACK_WORKERS = "4"
# This box serves real users over the tunnel, so it is production. Without this
# observability.js treats it as dev (isDev = NODE_ENV !== 'production') and
# returns raw err.message on every 500 — better-sqlite3 is synchronous, so
# "SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email" and SSH errors
# carrying internal switch IPs went straight back to whoever triggered them.
# It also locks CORS down. Set here rather than in .env because app.js's loader
# does "real env wins", and a stray inline comment in .env would silently make
# the value !== "production".
if (-not $env:NODE_ENV) { $env:NODE_ENV = "production" }
Start-Process "node" -ArgumentList "app.js" -WorkingDirectory "$ProjectRoot\server" -WindowStyle Minimized

# Start tunnel (skip silently if cloudflared.exe isn't here — local testing
# only needs http://localhost:3001).
if (Test-Path "$ProjectRoot\cloudflared.exe") {
    $log = "$ProjectRoot\cf_temp.log"
    Remove-Item $log -ErrorAction SilentlyContinue
    Start-Process "$ProjectRoot\cloudflared.exe" -ArgumentList "tunnel --url http://localhost:3001" -RedirectStandardError $log -WindowStyle Minimized

    # Wait for URL
    Write-Host "Starting tunnel..." -ForegroundColor Yellow
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep 2
        $content = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($content -match "https://[a-z0-9-]+\.trycloudflare\.com") {
            $url = $matches[0]
            Write-Host "`n=== TUNNEL URL ===" -ForegroundColor Cyan
            Write-Host $url -ForegroundColor Green
            Write-Host "==================`n" -ForegroundColor Cyan
            $url | Set-Content "$ProjectRoot\current-url.txt"
            break
        }
    }
} else {
    Write-Host "cloudflared.exe not found at $ProjectRoot — skipping tunnel (use http://localhost:3001 locally)." -ForegroundColor Yellow
}
