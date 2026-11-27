# Installs the Command Center on this PC. Run it through Install.cmd (double-click), or:
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Target <folder>] [-Yes] [-NoShortcuts] [-NoRuntime] [-NoStart] [-StartAtLogin]
# Refuses roots, home, Temp, Desktop, Documents; a non-empty unmarked folder gets a CommandCenter subfolder. -Yes takes every default and never asks. Installing over an old install updates the program and keeps your settings.
param([string]$Target, [switch]$Yes, [switch]$NoShortcuts, [switch]$NoRuntime, [switch]$NoStart, [switch]$StartAtLogin)
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
. (Join-Path $src 'lib\copy-app.ps1')

function Ask([string]$Question, [bool]$Default) {
  if ($Yes) { return $Default }
  $hint = if ($Default) { 'Y/n' } else { 'y/N' }
  $a = (Read-Host "$Question [$hint]").Trim().ToLower()
  if (-not $a) { return $Default }
  return $a.StartsWith('y')
}
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Test-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  if ((& node -v) -match '^v(\d+)\.(\d+)') { return ([int]$Matches[1] -gt 22) -or (([int]$Matches[1] -eq 22) -and ([int]$Matches[2] -ge 13)) }
  return $false
}
function Install-With-Winget([string]$Id, [string]$What) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
  if (-not (Ask "Install $What now with winget (winget install $Id)?" $true)) { return $false }
  & winget install --id $Id -e --accept-package-agreements --accept-source-agreements
  Refresh-Path
  return $true
}

Write-Host 'Command Center installer'
Write-Host ''
if (-not (Test-Node)) {
  Write-Host 'Node.js 22.13 or newer is missing or too old.'
  Install-With-Winget 'OpenJS.NodeJS.LTS' 'Node.js' | Out-Null
  if (-not (Test-Node)) { Write-Host 'Install Node.js 22.13 or newer from https://nodejs.org, open a new window, and run this again.'; exit 1 }
}
Write-Host "Node $(& node -v): ok"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'git is not installed (the panel uses it to show changes).'
  Install-With-Winget 'Git.Git' 'git' | Out-Null
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host 'Continuing without git. Get it from https://git-scm.com later.' }
}
if (Get-Command git -ErrorAction SilentlyContinue) { Write-Host 'git: ok' }

$default = Join-Path $env:LOCALAPPDATA 'CommandCenter'
if (-not $Target) {
  $Target = $default
  if (-not $Yes) { $a = Read-Host "Install folder [$default]"; if ($a.Trim()) { $Target = $a.Trim().Trim('"') } }
}
$Target = [IO.Path]::GetFullPath($Target); if ($Target.Length -gt 3) { $Target = $Target.TrimEnd('\') }
$srcFull = [IO.Path]::GetFullPath($src).TrimEnd('\')
if ($Target -ieq $srcFull) { Write-Host 'That is the folder this installer is in. Pick another folder.'; exit 1 }
if ($Target.StartsWith($srcFull + '\', [StringComparison]::OrdinalIgnoreCase)) { Write-Host 'The install folder cannot be inside the installer folder. Pick another folder.'; exit 1 }
$why = Get-CcUnsafeReason $Target
if ($why) { Write-Host "Refusing to install into $Target. It is $why. Pick another folder."; exit 1 }
$marker = Join-Path $Target '.cc-install'
$empty = -not (Test-Path -LiteralPath $Target) -or -not (Get-ChildItem -LiteralPath $Target -Force | Select-Object -First 1)
if (-not $empty -and -not (Test-Path -LiteralPath $marker) -and -not (Test-CcLooksInstalled $Target)) {
  $sub = Join-Path $Target 'CommandCenter'
  Write-Host "$Target already has other files in it, so I will not mix with them. Using $sub instead."
  $Target = $sub
  $marker = Join-Path $Target '.cc-install'
  if ((Test-Path -LiteralPath $Target) -and (Get-ChildItem -LiteralPath $Target -Force | Select-Object -First 1) -and -not (Test-Path -LiteralPath $marker) -and -not (Test-CcLooksInstalled $Target)) {
    Write-Host "$Target is not empty either. Pick an empty folder."; exit 1
  }
  if ($Target -ieq $srcFull -or $Target.StartsWith($srcFull + '\',[StringComparison]::OrdinalIgnoreCase)) { Write-Host 'That is the folder this installer is in. Pick another folder.'; exit 1 }
  $why = Get-CcUnsafeReason $Target
  if ($why) { Write-Host "Refusing to install into $Target. It is $why. Pick another folder."; exit 1 }
}
if (-not (Test-Path -LiteralPath $marker) -and (Test-CcLooksInstalled $Target)) {
  if ($Yes) { Write-Host "$Target has a Command Center copy that this installer did not make. Run without -Yes to confirm replacing it, or pick another folder."; exit 1 }
  if ((Read-Host "$Target has a Command Center copy that this installer did not make. Type yes to replace its program files") -ne 'yes') { Write-Host 'Nothing changed.'; exit 1 }
}
$updating = Test-Path -LiteralPath $marker
if (-not $updating -and (Test-CcLooksInstalled $Target)) { $updating = $true }
if ($updating) { Write-Host "Updating the install in $Target. Your settings stay." } else { Write-Host "Installing into $Target" }

New-Item -ItemType Directory -Force -Path $Target | Out-Null
Set-Content -LiteralPath $marker -Value "Command Center install. Created $(Get-Date -Format 'yyyy-MM-dd'). uninstall.ps1 only removes folders that have this file." -Encoding ASCII
$wasRunning = (Stop-CcPanel $Target) -gt 0
foreach ($d in $script:CcAppDirs) {
  $p = Join-Path $Target $d
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
}

$n = Copy-CcApp $src $Target
Write-Host "Copied $n files."

if (-not $NoRuntime) {
  $rtDir = Join-Path $Target 'runtime\node_modules\agent-interop-runtime'
  $cfgFile = Join-Path $Target 'config.json'
  if (Test-Path -LiteralPath $cfgFile) { try { $c = Get-Content -LiteralPath $cfgFile -Raw | ConvertFrom-Json; if ($c.runtimeDir) { $rtDir = [string]$c.runtimeDir } } catch { Write-Host 'config.json could not be read; using the default relay folder.' } }
  $rt = Join-Path $rtDir 'package.json'
  if (-not (Test-Path $rt)) {
    Write-Host 'Installing the relay program (this needs the internet and takes a minute)...'
    $cmd = (& node (Join-Path $Target 'lib\setup.mjs') command runtime install) | Select-Object -First 1
    & cmd.exe /c $cmd
    if ($LASTEXITCODE -ne 0) { Write-Host 'The relay install failed. Use the Install relay button on the Setup page later.' }
  } else { Write-Host 'Relay program: already installed.' }
  if (Test-Path $rt) {
    $env:AGENT_INTEROP_RUNTIME = $null
    & node (Join-Path $Target 'relay\reapply.mjs')
  }
}

if (-not $NoShortcuts) {
  $ps = (Get-Command powershell.exe).Source
  $shell = New-Object -ComObject WScript.Shell
  $make = {
    param($path, $extra)
    $l = $shell.CreateShortcut($path)
    $l.TargetPath = $ps
    $l.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Target\start.ps1`"$extra"
    $l.WorkingDirectory = $Target
    $l.WindowStyle = 7
    $l.Description = 'Command Center'
    $l.Save()
  }
  foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('DesktopDirectory'))) {
    $p = Join-Path $dir 'Command Center.lnk'
    & $make $p ''
    Write-Host "Shortcut: $p"
  }
  if ($StartAtLogin -or (Ask 'Start the Command Center when you sign in?' $false)) {
    $p = Join-Path ([Environment]::GetFolderPath('Startup')) 'Command Center.lnk'
    & $make $p ' -NoOpen'
    Write-Host "Shortcut: $p"
  }
}

if (-not $NoStart) {
  Write-Host 'Starting the panel. It opens on the Setup page the first time.'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Target 'start.ps1')
} elseif ($wasRunning) { Write-Host 'The old panel was stopped for the update. Start it again with start.ps1.' }
Write-Host ''
Write-Host "Done. Installed in $Target"
