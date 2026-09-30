$ErrorActionPreference = 'Stop'
$dashboardRoot = $PSScriptRoot
$dashboardUrl = 'http://127.0.0.1:8765/'
$phpExecutable = 'C:\xampp\php\php.exe'
if (-not (Test-Path -LiteralPath $phpExecutable)) {
    $phpCommand = Get-Command php -ErrorAction SilentlyContinue
    if (-not $phpCommand) { throw 'PHP was not found. Install PHP or update the PHP path in Start Dashboard.ps1.' }
    $phpExecutable = $phpCommand.Source
}
$running = $false
try {
    $page = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 2
    $running = $page.Content -match 'initializeBuilderTools'
    if (-not $running) { throw 'Port 8765 is being used by another application.' }
} catch {
    if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Port 8765 is in use. Stop that application before starting Brand Builder.'
    }
}
if (-not $running) {
    $server = Start-Process -FilePath $phpExecutable -ArgumentList @('-S', '127.0.0.1:8765', '-t', ('"' + $dashboardRoot + '"')) -WorkingDirectory $dashboardRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dashboardRoot 'server-output.log') -RedirectStandardError (Join-Path $dashboardRoot 'server-error.log')
    $server.Id | Set-Content -LiteralPath (Join-Path $dashboardRoot '.server.pid')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $page = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 2
            if ($page.Content -match 'initializeBuilderTools') { $running = $true; break }
        } catch {}
    }
    if (-not $running) { throw 'The dashboard did not start. Check server-error.log in this folder.' }
}
Start-Process $dashboardUrl
