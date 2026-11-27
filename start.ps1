# Starts the Command Center panel (4021) and, when OpenCode is on, the OpenCode server the relay needs (4096). Skips whichever already runs. -NoOpen skips opening the browser.
param([switch]$NoOpen)
$root = $PSScriptRoot
$up = { param($p) [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host 'Node.js is not installed. Run Install.cmd, or install Node 22.13 or newer from https://nodejs.org'; exit 1 }
$cfg = $null
if (Test-Path "$root/config.json") { $cfg = Get-Content "$root/config.json" -Raw | ConvertFrom-Json }
if (-not (& $up 4021)) { Start-Process node -ArgumentList "`"$root/viewer/server.mjs`"" -WorkingDirectory $root -WindowStyle Hidden }
$opencodeOn = -not $cfg -or -not $cfg.providers -or $cfg.providers.opencode -ne $false
if ($opencodeOn -and (Get-Command opencode -ErrorAction SilentlyContinue) -and -not (& $up 4096)) {
  $dir = if ($cfg -and $cfg.projectDir -and (Test-Path $cfg.projectDir)) { $cfg.projectDir } else { $root }
  Start-Process opencode -ArgumentList 'serve','--hostname','127.0.0.1','--port','4096' -WorkingDirectory $dir -WindowStyle Hidden
}
Start-Sleep -Seconds 2
"panel 4021: $(& $up 4021)  opencode 4096: $(& $up 4096)"
if ((& $up 4021) -and -not $NoOpen) { Start-Process 'http://127.0.0.1:4021' }
