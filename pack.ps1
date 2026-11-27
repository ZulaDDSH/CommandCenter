# Builds CommandCenter-<date>.zip from this folder, for installing on another PC (unzip, then double-click Install.cmd).
#   powershell -ExecutionPolicy Bypass -File pack.ps1 [-Out <zip path>]
param([string]$Out)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\copy-app.ps1')
if (-not $Out) { $Out = Join-Path $PSScriptRoot "CommandCenter-$(Get-Date -Format 'yyyyMMdd').zip" }
$Out = [IO.Path]::GetFullPath($Out)
$stage = Join-Path ([IO.Path]::GetTempPath()) ('cc-pack-' + [guid]::NewGuid().ToString('N'))
try {
  $n = Copy-CcApp $PSScriptRoot (Join-Path $stage 'CommandCenter')
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $Out) { Remove-Item -LiteralPath $Out -Force }
  $fs = [IO.File]::Open($Out, 'Create')
  $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($f in Get-ChildItem -LiteralPath $stage -Recurse -File -Force) {
      $name = $f.FullName.Substring($stage.Length + 1).Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $zip.Dispose(); $fs.Dispose() }
  Write-Host "Packed $n files into $Out"
  Write-Host 'Left out on purpose (per-PC data):'
  Get-CcLeftOut $PSScriptRoot | ForEach-Object { Write-Host "  $_" }
} finally { if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
