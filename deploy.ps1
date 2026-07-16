# RackTrack one-command deploy for the Windows GPU box.
#   .\deploy.ps1
# Pulls the latest code, rebuilds the web client, restarts the Node server
# (via start.ps1), and prints the commit the server is now actually running.
#
# Run this whenever you want the latest push live. It fixes the recurring
# "my fix isn't showing" problem, which is caused by the Node process not being
# restarted after a pull.

$ProjectRoot = "F:\dark_mobile"
$Remote = "july9"
$Branch = "july9_full"

Set-Location $ProjectRoot

Write-Host "`n[1/3] Pulling $Remote/$Branch ..." -ForegroundColor Cyan
git pull $Remote $Branch
$head = (git rev-parse --short HEAD).Trim()
Write-Host "  HEAD is now $head" -ForegroundColor DarkGray

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
        } else {
            Write-Host "  WARNING — live commit does not match HEAD ($head). Check for a second node process." -ForegroundColor Yellow
        }
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}
Write-Host ""
