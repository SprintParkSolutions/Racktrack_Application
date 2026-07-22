# RackTrack one-command deploy for the Windows GPU box.
#   .\deploy.ps1
# Pulls the latest code, rebuilds the web client, restarts the Node server
# (via start.ps1), and prints the commit the server is now actually running.
#
# Run this whenever you want the latest push live. It fixes the recurring
# "my fix isn't showing" problem, which is caused by the Node process not being
# restarted after a pull.

# Derived from where this script lives, not hardcoded: the checkout has moved
# drives more than once (F:\ -> D:\racktrack\), and a stale literal here means
# deploy silently runs against the wrong tree — or dies on Set-Location.
$ProjectRoot = $PSScriptRoot
$Remote = "july9"
$Branch = "july9_full"

Set-Location $ProjectRoot

Write-Host "`n[1/3] Pulling $Remote/$Branch ..." -ForegroundColor Cyan
$before = (git rev-parse --short HEAD).Trim()
git pull $Remote $Branch

# STOP if the pull failed. Without this the script sailed on, rebuilt the OLD
# tree and restarted Node, then reported success — so a deploy looked healthy
# (fresh uptime, no errors) while serving code 14 commits stale, security fixes
# included. The usual cause is uncommitted local edits to a file the incoming
# commits also touch: git refuses to overwrite them and exits non-zero.
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n  PULL FAILED — nothing was built or restarted." -ForegroundColor Red
    Write-Host "  The old version is still live. Most likely local edits block the merge:" -ForegroundColor Yellow
    git status --short
    Write-Host "`n  Fix with:  git stash push -m wip <file>   (keep them)" -ForegroundColor Yellow
    Write-Host "         or:  git reset --hard $Remote/$Branch  (discard them)" -ForegroundColor Yellow
    exit 1
}

$head = (git rev-parse --short HEAD).Trim()
Write-Host "  HEAD $before -> $head" -ForegroundColor DarkGray

# A successful pull that changed nothing is worth calling out too: it means the
# box was already current, so if the live version still looks old the problem is
# a second node process, not the pull.
if ($before -eq $head) {
    Write-Host "  (already up to date — no new commits)" -ForegroundColor DarkGray
}

Write-Host "`n[2/3] Building the web client ..." -ForegroundColor Cyan
Set-Location "$ProjectRoot\client"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  BUILD FAILED — server NOT restarted (old build stays up)." -ForegroundColor Red
    Set-Location $ProjectRoot
    exit 1
}
Set-Location $ProjectRoot

Write-Host "`n[3/3] Restarting the Node server (start.ps1) ..." -ForegroundColor Cyan
& "$ProjectRoot\start.ps1"

# Give the server a few seconds to bind + report its version.
Start-Sleep -Seconds 4
Write-Host "`nLive server version:" -ForegroundColor Green
for ($i = 0; $i -lt 10; $i++) {
    try {
        $v = (Invoke-WebRequest "http://localhost:3001/api/version" -UseBasicParsing -TimeoutSec 3).Content
        Write-Host "  $v" -ForegroundColor Green
        if ($v -match $head) {
            Write-Host "  OK — live commit matches HEAD ($head)." -ForegroundColor Green
            break
        } else {
            # Non-zero exit, not just a warning: a deploy that serves a different
            # commit than HEAD has failed, however healthy it looks.
            Write-Host "  FAILED — live commit does not match HEAD ($head)." -ForegroundColor Red
            Write-Host "  Another node process is probably serving an older tree:" -ForegroundColor Yellow
            Get-Process node -ErrorAction SilentlyContinue |
                Select-Object Id, Path | Format-Table -AutoSize
            exit 1
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}
Write-Host ""
