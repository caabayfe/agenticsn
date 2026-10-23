# Installs snagentic on Windows from a GitHub release, after checking the binary's SHA-256 sum and,
# when the GitHub CLI is installed and signed in, its build provenance (ADR-0043).
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
# The release's tag, so provenance can be checked against it: the latest one is resolved first.
$tag = if ($version -ne "latest") { "v$($version.TrimStart('v'))" }
  elseif (-not $env:SNAGENTIC_DOWNLOAD_BASE) {
    (Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -UseBasicParsing).tag_name
  } else { "" }
$base = if ($env:SNAGENTIC_DOWNLOAD_BASE) { $env:SNAGENTIC_DOWNLOAD_BASE }
  else { "https://github.com/$repo/releases/download/$tag" }

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
  # GitHub serves attestations only to signed-in requests, so without gh this is reported, not
  # required. A check that runs and fails installs nothing.
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  $signedIn = $false
  if ($gh) { & gh auth status *> $null; $signedIn = ($LASTEXITCODE -eq 0) }
  if ($signedIn) {
    $checks = @("--repo", $repo, "--signer-workflow", "$repo/.github/workflows/release.yml")
    if ($tag) { $checks += @("--source-ref", "refs/tags/$tag") }
    $env:GH_PROMPT_DISABLED = "1"
    & gh attestation verify $binary @checks *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "GitHub could not confirm the release workflow built $target; nothing was installed. Check it yourself: gh attestation verify <file> --repo $repo, and report it if it fails"
    }
    Write-Output "provenance verified: built by the release workflow$(if ($tag) { " from $tag" })"
  } else {
    Write-Output "provenance not checked (needs the GitHub CLI, signed in); checked against SHA256SUMS only"
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
