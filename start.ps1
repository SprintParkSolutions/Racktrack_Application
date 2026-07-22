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

# ── Tunnel ───────────────────────────────────────────────────────────────
# Prefer ngrok on the RESERVED domain recorded in BACKEND_URL. cloudflared's
# free tunnel hands out a new random hostname every restart, so the URL baked
# into the app kept going stale and builds shipped pointing at a dead host.
# A reserved domain means the URL never changes and the app keeps working
# across restarts.
$ngrok = Get-Command ngrok -ErrorAction SilentlyContinue
$backendFile = "$ProjectRoot\BACKEND_URL"
if ($ngrok -and (Test-Path $backendFile)) {
    $backend = (Get-Content $backendFile -Raw).Trim()
    $domain  = $backend -replace '^https?://', ''
    Write-Host "Starting ngrok on reserved domain $domain ..." -ForegroundColor Yellow
    Start-Process "ngrok" -ArgumentList "http 3001 --domain=$domain --log=stdout" `
        -RedirectStandardOutput "$ProjectRoot\ngrok.log" -WindowStyle Minimized

    # Confirm it actually came up rather than assuming — a bad authtoken or an
    # unclaimed domain fails immediately and silently in a minimized window.
    Start-Sleep 4
    $ok = $false
    for ($i = 0; $i -lt 15; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "$backend/healthz" -TimeoutSec 4 -UseBasicParsing `
                 -Headers @{ "ngrok-skip-browser-warning" = "1" }
            if ($r.StatusCode -eq 200) { $ok = $true; break }
        } catch { Start-Sleep 2 }
    }
    if ($ok) {
        Write-Host "`n=== TUNNEL UP ===" -ForegroundColor Cyan
        Write-Host $backend -ForegroundColor Green
        Write-Host "=================`n" -ForegroundColor Cyan
        $backend | Set-Content "$ProjectRoot\current-url.txt"
    } else {
        Write-Host "`n!! ngrok did not answer on $backend" -ForegroundColor Red
        Write-Host "   Check $ProjectRoot\ngrok.log — usually a stale authtoken" -ForegroundColor Red
        Write-Host "   or the domain belongs to a different ngrok account.`n" -ForegroundColor Red
    }
}
elseif (Test-Path "$ProjectRoot\cloudflared.exe") {
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
