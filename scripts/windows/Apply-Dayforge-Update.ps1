param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = 'Stop'

$patchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceExe = Join-Path $patchRoot 'dayforge.exe'
if (-not [System.IO.File]::Exists($sourceExe)) {
  throw "Patch payload is incomplete: dayforge.exe was not found next to this script."
}

$candidates = New-Object System.Collections.Generic.List[string]

function Add-Candidate {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"'))
  if ([string]::IsNullOrWhiteSpace($expanded)) { return }
  if (-not $candidates.Contains($expanded)) { $candidates.Add($expanded) }
}

function Add-InstallDirectory {
  param([string]$Directory)

  if ([string]::IsNullOrWhiteSpace($Directory)) { return }
  $clean = [Environment]::ExpandEnvironmentVariables($Directory.Trim().Trim('"'))
  if ([string]::IsNullOrWhiteSpace($clean)) { return }

  if ([System.IO.Path]::GetExtension($clean) -ieq '.exe') {
    Add-Candidate $clean
    return
  }

  # System.IO.Path.Combine does not ask PowerShell to mount/resolve the drive.
  # That matters when an old uninstall entry points to a drive that no longer exists.
  Add-Candidate ([System.IO.Path]::Combine($clean, 'dayforge.exe'))
  Add-Candidate ([System.IO.Path]::Combine($clean, 'Dayforge.exe'))
}

function Find-FirstExistingCandidate {
  foreach ($candidate in $candidates) {
    try {
      if ([System.IO.File]::Exists($candidate)) { return $candidate }
    } catch {
      # A stale/broken path must never abort discovery of the real installation.
    }
  }
  return $null
}

function Add-RegistryEntryCandidates {
  param($Entry)

  if (-not $Entry) { return }
  if ($Entry.DisplayName -notlike 'Dayforge*') { return }

  Add-InstallDirectory $Entry.InstallLocation

  if ($Entry.DisplayIcon) {
    $iconPath = (($Entry.DisplayIcon -replace ',\d+$', '').Trim().Trim('"'))
    Add-Candidate $iconPath
  }

  if ($Entry.UninstallString) {
    $uninstall = [Environment]::ExpandEnvironmentVariables([string]$Entry.UninstallString)
    $uninstallExe = $null
    if ($uninstall -match '^\s*"([^"]+\.exe)"') {
      $uninstallExe = $Matches[1]
    } elseif ($uninstall -match '^\s*([^\s]+\.exe)') {
      $uninstallExe = $Matches[1]
    }

    if ($uninstallExe) {
      try {
        Add-InstallDirectory ([System.IO.Path]::GetDirectoryName($uninstallExe))
      } catch {
        # Ignore malformed stale uninstall entries.
      }
    }
  }
}

# Explicit path wins.
if ($InstallDir) {
  Add-InstallDirectory $InstallDir
}

# If Dayforge is running, its executable is the most reliable installation path.
$runningPath = $null
$running = Get-Process -Name 'dayforge' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($running) {
  try { $runningPath = $running.Path } catch { $runningPath = $null }
  Add-Candidate $runningPath
}

# Common current-user and machine-wide locations.
Add-InstallDirectory ([System.IO.Path]::Combine($env:LOCALAPPDATA, 'Dayforge'))
Add-InstallDirectory ([System.IO.Path]::Combine($env:LOCALAPPDATA, 'Programs', 'Dayforge'))
if ($env:ProgramFiles) {
  Add-InstallDirectory ([System.IO.Path]::Combine($env:ProgramFiles, 'Dayforge'))
}
$programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
if ($programFilesX86) {
  Add-InstallDirectory ([System.IO.Path]::Combine($programFilesX86, 'Dayforge'))
}

# Read each uninstall entry independently. One stale entry (for example E:\...)
# must not prevent later valid entries from being checked.
$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

foreach ($root in $uninstallRoots) {
  try {
    $entries = Get-ItemProperty $root -ErrorAction SilentlyContinue
    foreach ($entry in $entries) {
      try { Add-RegistryEntryCandidates $entry } catch { }
    }
  } catch {
    Write-Host "Registry root skipped: $root"
  }
}

# Start-menu shortcuts are another reliable source when the uninstall registry
# contains an obsolete install path.
try {
  $shell = New-Object -ComObject WScript.Shell
  $shortcutRoots = @(
    [System.IO.Path]::Combine($env:APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    [System.IO.Path]::Combine($env:ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  )
  foreach ($shortcutRoot in $shortcutRoots) {
    if (-not [System.IO.Directory]::Exists($shortcutRoot)) { continue }
    $shortcuts = Get-ChildItem -LiteralPath $shortcutRoot -Filter '*Dayforge*.lnk' -File -Recurse -ErrorAction SilentlyContinue
    foreach ($shortcut in $shortcuts) {
      try {
        $targetPath = $shell.CreateShortcut($shortcut.FullName).TargetPath
        Add-Candidate $targetPath
      } catch { }
    }
  }
} catch { }

$targetExe = Find-FirstExistingCandidate

# Last-resort targeted search. This only runs if normal install metadata was not usable.
if (-not $targetExe) {
  $searchRoots = @($env:LOCALAPPDATA, $env:ProgramFiles, $programFilesX86) |
    Where-Object { $_ -and [System.IO.Directory]::Exists($_) } |
    Select-Object -Unique

  foreach ($root in $searchRoots) {
    try {
      $found = Get-ChildItem -LiteralPath $root -Filter 'dayforge.exe' -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '(?i)dayforge' } |
        Select-Object -First 1
      if ($found) {
        $targetExe = $found.FullName
        break
      }
    } catch { }
  }
}

# If automatic discovery still fails, allow a one-time paste instead of forcing
# the user to reinstall or edit the script.
if (-not $targetExe) {
  Write-Host ""
  Write-Host "Dayforge was not found automatically." -ForegroundColor Yellow
  Write-Host "Paste the Dayforge installation folder or the full path to dayforge.exe."
  Write-Host "You can usually find it from the Dayforge shortcut: right-click > Open file location."
  $manualPath = Read-Host "Dayforge path"
  Add-InstallDirectory $manualPath
  $targetExe = Find-FirstExistingCandidate
}

if (-not $targetExe) {
  throw "Dayforge installation was not found. No files or Dayforge data were changed."
}

# Stop Dayforge only after a valid target has been found. This avoids closing the
# app when discovery fails and makes the patch easier to retry.
Get-Process -Name 'dayforge' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 700

$backupExe = "$targetExe.pre-update.bak"
Copy-Item -LiteralPath $targetExe -Destination $backupExe -Force

$tempExe = "$targetExe.update.tmp"
Copy-Item -LiteralPath $sourceExe -Destination $tempExe -Force
Move-Item -LiteralPath $tempExe -Destination $targetExe -Force

Write-Host ""
Write-Host "Dayforge executable updated successfully." -ForegroundColor Green
Write-Host "Existing SQLite data was not touched."
Write-Host "Backup: $backupExe"

Start-Process -FilePath $targetExe
