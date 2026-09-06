param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = 'Stop'

$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceExe = Join-Path $patchRoot 'dayforge.exe'
if (-not (Test-Path $sourceExe -PathType Leaf)) {
  throw "Patch payload is incomplete: dayforge.exe was not found next to this script."
}

$runningPath = $null
$running = Get-Process -Name 'dayforge' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($running) {
  try { $runningPath = $running.Path } catch { $runningPath = $null }
  Get-Process -Name 'dayforge' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 700
}

$candidates = New-Object System.Collections.Generic.List[string]
if ($InstallDir) {
  $candidates.Add((Join-Path $InstallDir 'dayforge.exe'))
  $candidates.Add((Join-Path $InstallDir 'Dayforge.exe'))
}
if ($runningPath) { $candidates.Add($runningPath) }
$candidates.Add((Join-Path $env:LOCALAPPDATA 'Dayforge\dayforge.exe'))
$candidates.Add((Join-Path $env:LOCALAPPDATA 'Dayforge\Dayforge.exe'))

try {
  $uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($entry in Get-ItemProperty $uninstallRoots -ErrorAction SilentlyContinue) {
    if ($entry.DisplayName -ne 'Dayforge') { continue }
    if ($entry.InstallLocation) {
      $candidates.Add((Join-Path $entry.InstallLocation 'dayforge.exe'))
      $candidates.Add((Join-Path $entry.InstallLocation 'Dayforge.exe'))
    }
    if ($entry.DisplayIcon) {
      $iconPath = ($entry.DisplayIcon -replace ',\d+$', '').Trim('"')
      if ($iconPath) { $candidates.Add($iconPath) }
    }
  }
} catch {
  Write-Host "Registry lookup skipped: $($_.Exception.Message)"
}

$targetExe = $candidates |
  Where-Object { $_ -and (Test-Path $_ -PathType Leaf) } |
  Select-Object -First 1

if (-not $targetExe) {
  throw "Dayforge installation was not found. Keep Dayforge installed, then run this patch again. You may also run: powershell -ExecutionPolicy Bypass -File Apply-Dayforge-Update.ps1 -InstallDir 'C:\path\to\Dayforge'"
}

$backupExe = "$targetExe.pre-update.bak"
Copy-Item $targetExe $backupExe -Force

$tempExe = "$targetExe.update.tmp"
Copy-Item $sourceExe $tempExe -Force
Move-Item $tempExe $targetExe -Force

Write-Host "Dayforge executable updated successfully."
Write-Host "Existing SQLite data was not touched."
Write-Host "Backup: $backupExe"

Start-Process $targetExe
