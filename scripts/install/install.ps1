# Installs snagentic on Windows from a GitHub release, after checking the binary's SHA-256 sum.
#   irm https://github.com/caabayfe/agenticsn/releases/latest/download/install.ps1 | iex
# Environment: SNAGENTIC_VERSION (default: latest), SNAGENTIC_INSTALL_DIR (default:
# %LOCALAPPDATA%\snagentic\bin), SNAGENTIC_DOWNLOAD_BASE (a URL holding the release files).
$ErrorActionPreference = "Stop"

$repo = "caabayfe/agenticsn"
$version = if ($env:SNAGENTIC_VERSION) { $env:SNAGENTIC_VERSION } else { "latest" }
$installDir = if ($env:SNAGENTIC_INSTALL_DIR) { $env:SNAGENTIC_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "snagentic\bin" }
if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
  throw "snagentic has no build for Windows on $($env:PROCESSOR_ARCHITECTURE)"
}
$target = "snagentic-windows-x64.exe"
$base = if ($env:SNAGENTIC_DOWNLOAD_BASE) { $env:SNAGENTIC_DOWNLOAD_BASE }
  elseif ($version -eq "latest") { "https://github.com/$repo/releases/latest/download" }
  else { "https://github.com/$repo/releases/download/v$($version.TrimStart('v'))" }

$work = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid()))
try {
  $binary = Join-Path $work "snagentic.exe"
  Invoke-WebRequest "$base/$target" -OutFile $binary -UseBasicParsing
  $sums = (Invoke-WebRequest "$base/SHA256SUMS" -UseBasicParsing).Content
  $expected = ($sums -split "`n" | Where-Object { $_ -match " $([regex]::Escape($target))\s*$" } | ForEach-Object { ($_ -split "\s+")[0] }) | Select-Object -First 1
  $actual = (Get-FileHash $binary -Algorithm SHA256).Hash.ToLower()
  if (-not $expected -or $expected.ToLower() -ne $actual) {
    throw "the downloaded $target does not match SHA256SUMS; nothing was installed"
  }
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  Move-Item -Force $binary (Join-Path $installDir "snagentic.exe")
  Write-Output "installed snagentic in $installDir"
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not ($userPath -split ";" -contains $installDir)) {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
    Write-Output "added $installDir to your PATH; open a new terminal to use snagentic"
  }
} finally {
  Remove-Item -Recurse -Force $work
}
