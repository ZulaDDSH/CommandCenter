# Shared by install.ps1, uninstall.ps1 and pack.ps1. Copies the app and leaves out per-PC data. Paths are relative to the app root.
$script:CcExcluded = @('config.json', 'tasks.json', 'tasks', 'logs', 'reports', 'board.jsonl', 'runtime', 'backups', 'disabled-extensions.json', 'session-meta.json', 'session-meta.json.tmp', 'trash', 'goals.json', 'goals.json.tmp', 'machines.json', 'machines.json.tmp', 'state', '.cc-install', 'docs/AGENT-BRIEF-COMMON.md', 'docs/code-notes', 'docs/director', '.freebuff', '.git', 'CommandCenter-*.zip')
# Program-code folders only: install deletes them before copying so files removed upstream do not linger. Never list per-PC data here.
$script:CcAppDirs = @('lib', 'viewer', 'hooks', 'relay', 'tools', 'usage', 'docs\ai-guide')

function Test-CcExcluded([string]$Rel) {
  foreach ($x in $script:CcExcluded) { if ($Rel -like $x -or $Rel -like "$x/*") { return $true } }
  return $false
}

function Get-CcLeftOut([string]$Source) {
  foreach ($x in $script:CcExcluded) {
    Get-Item -Path (Join-Path $Source $x) -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($Source.Length + 1).Replace('\', '/') }
  }
}

function Copy-CcApp([string]$Source, [string]$Dest) {
  $Source = (Resolve-Path -LiteralPath $Source).Path.TrimEnd('\')
  $script:ccCount = 0
  $walk = {
    param($dir)
    foreach ($i in Get-ChildItem -LiteralPath $dir -Force) {
      $rel = $i.FullName.Substring($Source.Length + 1).Replace('\', '/')
      if (Test-CcExcluded $rel) { continue }
      if ($i.PSIsContainer) { & $walk $i.FullName; continue }
      $to = Join-Path $Dest $rel
      New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null
      Copy-Item -LiteralPath $i.FullName -Destination $to -Force
      $script:ccCount++
    }
  }
  & $walk $Source
  return $script:ccCount
}

# Returns why a folder must never be installed into or removed, or $null when it is allowed (drive roots, home, TEMP, Desktop, Documents and any folder containing them).
function Get-CcUnsafeReason([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (Test-Path -LiteralPath $full) { $full = (Get-Item -LiteralPath $full -Force).FullName }
  if ([IO.Path]::GetPathRoot($full) -ieq $full) { return 'a drive root' }
  $p = $full.TrimEnd('\')
  $guard = @($env:USERPROFILE, $env:TEMP, $env:LOCALAPPDATA, $env:APPDATA, $env:ProgramFiles, $env:windir, [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('MyDocuments'))
  foreach ($g in $guard) {
    if (-not $g) { continue }
    $g = [IO.Path]::GetFullPath($g).TrimEnd('\')
    if (($g -ieq $p) -or $g.StartsWith($p + '\', [StringComparison]::OrdinalIgnoreCase)) { return "your home, temp, Desktop, Documents or program folder (or a folder that contains it): $g" }
  }
  return $null
}

function Test-CcLooksInstalled([string]$Dir) {
  return (Test-Path -LiteralPath (Join-Path $Dir 'viewer\server.mjs')) -and (Test-Path -LiteralPath (Join-Path $Dir 'lib\setup.mjs'))
}

# Stops only the node process running this folder's viewer\server.mjs; returns how many it stopped.
function Stop-CcPanel([string]$Dir) {
  $mine = "$Dir\viewer\server.mjs"
  $stopped = 0
  $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\').IndexOf($mine, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
  foreach ($p in $procs) {
    Write-Host "Stopping the panel (process $($p.ProcessId))"
    Stop-Process -Id $p.ProcessId -Force
    Wait-Process -Id $p.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    $stopped++
  }
  return $stopped
}
