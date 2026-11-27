# Removes the Command Center: stops its panel, removes its shortcuts, its hook in the Claude settings and its MCP entries, then deletes the folder.
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-Target <folder>] [-Yes]
# Only folders that install.ps1 marked with .cc-install are removed. Nothing is kept: settings, tasks, logs and reports in that folder are deleted too.
param([string]$Target = $PSScriptRoot, [switch]$Yes)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\copy-app.ps1')
$Target = [IO.Path]::GetFullPath($Target); if ($Target.Length -gt 3) { $Target = $Target.TrimEnd('\') }
if (-not (Test-CcLooksInstalled $Target)) { Write-Host "$Target does not look like a Command Center folder. Nothing was changed."; exit 1 }
$why = Get-CcUnsafeReason $Target
if ($why) { Write-Host "Refusing to remove $Target. It is $why. Nothing was changed."; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $Target '.cc-install'))) {
  Write-Host "$Target has no .cc-install marker, so it was not made by the installer (a development folder, or an install from before the marker existed). Nothing was changed."
  Write-Host 'To remove an older install, run install.ps1 over it first (it adds the marker), then uninstall again.'
  exit 1
}
$items = @(Get-ChildItem -LiteralPath $Target -Recurse -Force)
if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { Write-Host "$Target contains a link (junction or symlink). Remove the link by hand first so nothing outside the folder is deleted. Nothing was changed."; exit 1 }
$files = @($items | Where-Object { -not $_.PSIsContainer })
$mb = [math]::Round((($files | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "This will remove the Command Center in $Target"
Write-Host "It deletes the folder with all its settings, tasks, logs, reports and deleted sessions in its trash folder ($($files.Count) files, $mb MB), the Command Center shortcuts, the one-CLI hook in your Claude settings (a backup is saved first) and the command-center MCP entry in Claude, Codex, OpenCode and Cursor."
if (-not $Yes) { if ((Read-Host 'Type yes to continue').Trim().ToLower() -ne 'yes') { Write-Host 'Cancelled. Nothing was changed.'; exit 0 } }

$settings = Join-Path $env:USERPROFILE '.claude\settings.json'
$hasHook = (Test-Path -LiteralPath $settings) -and (Select-String -LiteralPath $settings -Pattern 'freebuff-one-cli' -Quiet)
if (Get-Command node -ErrorAction SilentlyContinue) {
  & node (Join-Path $Target 'lib\setup.mjs') hook remove (Join-Path $env:USERPROFILE '.claude\backups')
  if ($LASTEXITCODE -ne 0) { Write-Host "Could not remove the hook from $settings (see above). The folder was NOT deleted. Fix that file, then run this again."; exit 1 }
} elseif ($hasHook) {
  Write-Host "Node.js was not found and $settings still has the Command Center hook. Install Node.js and run this again. The folder was NOT deleted."; exit 1
}

if ((Stop-CcPanel $Target) -gt 0) { Write-Host 'Panel stopped.' }
Write-Host 'The OpenCode server on port 4096, if it runs, is left alone.'

if (Get-Command node -ErrorAction SilentlyContinue) {
  $env:CC_BACKUP_DIR = Join-Path $env:USERPROFILE '.claude\backups'
  foreach ($c in @('claude', 'codex', 'opencode', 'cursor')) {
    & node (Join-Path $Target 'tools\register.mjs') $c --remove
    if ($LASTEXITCODE -ne 0) { Write-Host "Warning: could not remove the command-center entry from $c. Remove it by hand if it is still listed." }
  }
}
Write-Host 'If you registered the relay (agent-interop-runtime) with Claude and no longer want it, run: claude mcp remove agent-interop-runtime -s user'

$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Startup'))) {
  if (-not $dir) { continue }
  $p = Join-Path $dir 'Command Center.lnk'
  if ((Test-Path -LiteralPath $p) -and ($shell.CreateShortcut($p).Arguments.IndexOf("$Target\start.ps1", [StringComparison]::OrdinalIgnoreCase) -ge 0)) { Remove-Item -LiteralPath $p -Force; Write-Host "Removed $p" }
}

Set-Location $env:TEMP; [Environment]::CurrentDirectory = $env:TEMP
Remove-Item -LiteralPath $Target -Recurse -Force
Write-Host "Removed $Target"
