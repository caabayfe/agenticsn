# Onboards a ServiceNow PDI for the ITSM accelerator on Windows, from an empty workspace to the installed pack.
# The same steps as bin/onboard-pdi.sh:
#   1. asks for the instance, a profile name, the user and the password (never echoed, never written to disk);
#   2. checks the instance is awake and that REST accepts the user (Brazil refuses Basic auth without snc_basic_auth_api_access);
#   3. creates the workspace spaces\<profile>-<instance>, adds the profile, stores the password in Credential Manager (snagentic auth login);
#   4. marks the instance for the pack's regression (nttdata.acc.regression.instance_kind = development:<instance_name>);
#   5. runs snagentic doctor, the first pull and integrate;
#   6. pins the pack at a commit in a detached worktree (ntt-accelerators-pin-<profile>-<commit>) and points the workspace at it;
#   7. where the instance replaces another one, retires that one after you say yes: forgets its password, moves its workspace to
#      spaces-archive\<date>\ and removes its pack pins (a pin with local changes or a commit no branch holds is kept);
#   8. plans the ITSM install with demo data and, after you say yes, runs it.
# Run it again with the same answers to continue after a failure: the steps already done are skipped.
#
#   .\scripts\onboard\onboard-pdi.ps1
#   .\scripts\onboard\onboard-pdi.ps1 -Retire pdi7                       # only retire a profile, onboard nothing
#   $env:SNAGENTIC = 'C:\path\snagentic.exe'; .\scripts\onboard\onboard-pdi.ps1   # another snagentic build
#   $env:ONBOARD_ROOT = 'C:\path\folder'                                  # where ntt-accelerators and spaces\ live
#
# Needs git and snagentic (install.ps1 puts snagentic.exe in %LOCALAPPDATA%\snagentic\bin). Windows PowerShell 5.1 or PowerShell 7.
# Not yet run on a Windows machine: report what fails.
[CmdletBinding()]
param([string]$Retire = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# The folder that holds the sn-accelerators clone (ntt-accelerators), the spaces\ workspaces and the pack pins:
# by default the folder that holds this repository. $env:ONBOARD_ROOT names another.
$Root = if ($env:ONBOARD_ROOT) { $env:ONBOARD_ROOT } else { (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
$Snagentic = if ($env:SNAGENTIC) { $env:SNAGENTIC } else { Join-Path $env:LOCALAPPDATA 'snagentic\bin\snagentic.exe' }
$PackRepo = Join-Path $Root 'ntt-accelerators'
$Spaces = Join-Path $Root 'spaces'
$DefaultRef = 'origin/audit/round-2'

$script:Auth = ''   # the Basic authorization value; never printed, never written to a file

function Say($text) { Write-Host "`n== $text" }
function Note($text) { Write-Host "   $text" }
function Die($text) { Write-Host "`nonboard: $text" -ForegroundColor Red; exit 1 }
function Ask($prompt, $default = '') {
    $suffix = if ($default) { " [$default]" } else { '' }
    $reply = Read-Host "$prompt$suffix"
    if ($reply) { $reply } else { $default }
}
function Confirm-Yes($prompt) { (Read-Host "$prompt [y/N]") -match '^[yY]$' }

# git and snagentic report failure by exit code, which $ErrorActionPreference does not see.
function Invoke-Native([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($Exe)) $($Arguments -join ' ') failed (exit $LASTEXITCODE)" }
}
function Invoke-Git([string[]]$Arguments) { Invoke-Native 'git' $Arguments }
function Get-Git([string[]]$Arguments) {
    $out = & git @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    ($out | Out-String).Trim()
}

# A REST call as the user. Returns @{ Status; Body } and never throws on an HTTP error.
function Invoke-Api([string]$Method, [string]$Path, [string]$Data = '') {
    $headers = @{ Accept = 'application/json'; Authorization = $script:Auth }
    $params = @{ Uri = "https://$script:HostName$Path"; Method = $Method; Headers = $headers; UseBasicParsing = $true; ErrorAction = 'Stop' }
    if ($Data) { $params.Body = $Data; $params.ContentType = 'application/json' }
    try {
        $response = Invoke-WebRequest @params
        return @{ Status = [int]$response.StatusCode; Body = $response.Content }
    } catch {
        $status = 0
        $body = ''
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($_.ErrorDetails) { $body = $_.ErrorDetails.Message }
        return @{ Status = $status; Body = $body }
    }
}

function Get-JsonValue([string]$Body, [string]$Field) {
    try {
        $first = ($Body | ConvertFrom-Json).result | Select-Object -First 1
        $value = if ($null -eq $first) { $null } else { $first.$Field }
        if ($null -eq $value) { '' } else { [string]$value }
    } catch { '' }
}

# Retires a profile once you say yes: forgets its password, archives its workspaces, removes its pack pins. Nothing on the instance is
# touched, no branch is deleted, and a pin holding work found nowhere else is kept.
function Invoke-Retire([string]$Old, [string]$Keep = '') {
    $spaces = @(Get-ChildItem -Path $Spaces -Directory -ErrorAction SilentlyContinue |
        Where-Object { ($_.Name -eq $Old -or $_.Name -like "$Old-*") -and $_.FullName -ne $Keep -and (Test-Path (Join-Path $_.FullName "instances\$Old\instance.yaml")) })
    $pins = @(Get-ChildItem -Path $Root -Directory -Filter "ntt-accelerators-pin-$Old*" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "ntt-accelerators-pin-$Old" -or $_.Name -like "ntt-accelerators-pin-$Old-*" })
    if ($spaces.Count + $pins.Count -eq 0) { Note "nothing of $Old found: no workspace in $Spaces, no pack pin"; return }

    $archive = Join-Path $Root "spaces-archive\$(Get-Date -Format 'yyyy-MM-dd')"
    Note "retiring $Old would:"
    foreach ($item in $spaces) { Note "  forget its password in Credential Manager, and move $($item.FullName) to $archive\" }
    foreach ($item in $pins) { Note "  remove the pack pin $($item.FullName)" }
    if (-not (Confirm-Yes "Retire $Old now?")) { Note "$Old kept as it is"; return }

    foreach ($item in $spaces) {
        Push-Location $item.FullName
        try { & $Snagentic auth logout $Old; if ($LASTEXITCODE -ne 0) { Note "  the password of $Old could not be removed (already gone?)" } } finally { Pop-Location }
        New-Item -ItemType Directory -Force -Path $archive | Out-Null
        if (Test-Path (Join-Path $archive $item.Name)) {
            Note "  $archive\$($item.Name) already exists: $($item.FullName) left where it is"
        } else {
            Move-Item -Path $item.FullName -Destination $archive
            Note "  moved $($item.Name) to $archive\"
        }
    }
    foreach ($item in $pins) {
        if (Get-Git @('-C', $item.FullName, 'status', '--porcelain')) {
            Note "  kept $($item.Name): it has local changes"
        } elseif (-not (Get-Git @('-C', $item.FullName, 'for-each-ref', '--contains', 'HEAD', '--format=%(refname)', 'refs/heads', 'refs/remotes'))) {
            Note "  kept $($item.Name): its commit is on no branch"
        } elseif ($null -ne (Get-Git @('-C', $PackRepo, 'worktree', 'remove', $item.FullName))) {
            Note "  removed $($item.Name)"
        } else {
            Note "  kept $($item.Name): git would not remove it"
        }
    }
}

# --- 0. Tools ---------------------------------------------------------------------------------------------------------------------
if (-not (Test-Path $Snagentic)) { Die "no snagentic at $Snagentic (set `$env:SNAGENTIC to its path)" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'git is missing' }
if (-not (Test-Path (Join-Path $PackRepo '.git'))) { Die "no sn-accelerators clone at $PackRepo" }

if ($Retire) {
    if ($Retire -notmatch '^[a-z][a-z0-9-]*$') { Die 'usage: onboard-pdi.ps1 -Retire <profile>' }
    Say "Retiring $Retire"
    Invoke-Retire $Retire
    exit 0
}

try {
    # --- 1. Questions -------------------------------------------------------------------------------------------------------------
    Say 'The instance'
    $raw = Ask 'Instance (dev12345 or its https address)'
    $instance = $raw -replace '^https?://', '' -replace '\.service-now\.com.*$', '' -replace '/.*$', ''
    if ($instance -notmatch '^[a-z0-9-]+$') { Die "not an instance name: $raw" }
    $script:HostName = "$instance.service-now.com"
    $profileName = Ask 'Profile name, short (pdi7)'
    if ($profileName -notmatch '^[a-z][a-z0-9-]*$') { Die "a profile name is lower case letters, digits and dashes: $profileName" }
    $username = Ask 'User' 'admin'
    $secure = Read-Host "Password for $username on $script:HostName (not shown)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if (-not $password) { Die 'no password given' }
    $script:Auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${username}:$password"))
    $ref = Ask 'Pack commit or branch to install' $DefaultRef
    $replaces = Ask 'Profile this instance replaces, retired once this one is pulled (empty: none)'
    if ($replaces -and $replaces -notmatch '^[a-z][a-z0-9-]*$') { Die "not a profile name: $replaces" }
    if ($replaces -eq $profileName) { Die "an instance cannot replace itself: give the old profile's name, or nothing" }
    $workspace = Join-Path $Spaces "$profileName-$instance"
    Note "workspace: $workspace"

    # --- 2. Awake, and REST accepts the user --------------------------------------------------------------------------------------
    Say "Checking $script:HostName"
    while ($true) {
        $r = Invoke-Api 'GET' '/api/now/table/sys_properties?sysparm_query=name%3Dinstance_name&sysparm_fields=value&sysparm_limit=1'
        $instanceName = Get-JsonValue $r.Body 'value'
        if ($r.Status -eq 200 -and $instanceName) { Note "awake; instance_name is $instanceName"; break }
        if ($r.Status -eq 401) {
            Note "REST refused $username (401). Either the password is wrong, or, on Brazil, the user lacks the role"
            Note "snc_basic_auth_api_access. In the browser, as ${username}: open"
            Note "  https://$script:HostName/sys_user_list.do?sysparm_query=user_name%3D$username"
            Note 'then Roles > Edit > add snc_basic_auth_api_access, and save.'
        } elseif (($r.Status -eq 200) -or ($r.Status -eq 0) -or ($r.Status -ge 300 -and $r.Status -lt 400) -or ($r.Status -ge 500)) {
            Note "no answer from the instance's API (HTTP $($r.Status)): the PDI is probably asleep or waking up."
            Note 'Wake it at https://developer.servicenow.com (Manage > Instance), wait until it opens in the browser.'
        } else {
            $shown = if ($r.Body.Length -gt 300) { $r.Body.Substring(0, 300) } else { $r.Body }
            Note "unexpected answer (HTTP $($r.Status)): $shown"
        }
        if (-not (Confirm-Yes 'Check again?')) { Die "stopped: the instance is not reachable as $username" }
    }

    # --- 3. Workspace, profile, Credential Manager --------------------------------------------------------------------------------
    Say 'Workspace'
    if (Test-Path (Join-Path $workspace 'snagentic.yaml')) {
        Note 'already there: continuing in it'
    } else {
        if (Test-Path $workspace) { Die "$workspace exists but is not a snagentic workspace: move it away first" }
        Invoke-Native $Snagentic @('init', $workspace)
    }
    Set-Location $workspace

    $instanceFile = "instances\$profileName\instance.yaml"
    if (Test-Path $instanceFile) {
        if (-not (Select-String -Path $instanceFile -SimpleMatch $script:HostName -Quiet) -and -not (Select-String -Path $instanceFile -SimpleMatch $instance -Quiet)) {
            Die "profile $profileName already names another instance: pick another profile name"
        }
        Note "profile $profileName already added"
    } else {
        Invoke-Native $Snagentic @('instance', 'add', $profileName, '--url', $instance, '--username', $username, '--kind', 'development')
    }

    Say 'Storing the password in Credential Manager'
    $password | & $Snagentic auth login $profileName
    if ($LASTEXITCODE -ne 0) { Die 'auth login failed' }
    $password = ''

    # --- 4. Regression mark -------------------------------------------------------------------------------------------------------
    Say "Marking the instance for the pack's regression"
    $mark = "development:$instanceName"
    $r = Invoke-Api 'GET' '/api/now/table/sys_properties?sysparm_query=name%3Dnttdata.acc.regression.instance_kind&sysparm_fields=sys_id,value&sysparm_limit=1'
    $markId = Get-JsonValue $r.Body 'sys_id'
    $markNow = Get-JsonValue $r.Body 'value'
    if ($markNow -eq $mark) {
        Note "already $mark"
    } else {
        if ($markId) {
            $r = Invoke-Api 'PATCH' "/api/now/table/sys_properties/$markId" (@{ value = $mark } | ConvertTo-Json -Compress)
        } else {
            $body = @{ name = 'nttdata.acc.regression.instance_kind'; value = $mark; type = 'string'
                description = "The pack's regression runs here: development or test, with this instance's name. Never on production." } | ConvertTo-Json -Compress
            $r = Invoke-Api 'POST' '/api/now/table/sys_properties' $body
        }
        if ($r.Status -ne 200 -and $r.Status -ne 201) { Die "could not set nttdata.acc.regression.instance_kind (HTTP $($r.Status))" }
        Note "set to $mark"
    }

    # --- 5. Doctor, first pull ----------------------------------------------------------------------------------------------------
    Say 'snagentic doctor'
    & $Snagentic doctor --instance $profileName
    if ($LASTEXITCODE -ne 0 -and -not (Confirm-Yes 'doctor reported problems (above). Continue anyway?')) { Die 'stopped after doctor' }

    Say 'First pull and integrate (long on a fresh instance; resumable: run this script again if it stops)'
    Invoke-Native $Snagentic @('pull', $profileName)
    Invoke-Native $Snagentic @('integrate', $profileName)

    # --- 6. Pack pin --------------------------------------------------------------------------------------------------------------
    Say 'Pinning the pack'
    Invoke-Git @('-C', $PackRepo, 'fetch', '-q', 'origin')
    $commit = Get-Git @('-C', $PackRepo, 'rev-parse', '--short=8', "$ref^{commit}")
    if (-not $commit) { Die "no commit $ref in $PackRepo" }
    $pin = "ntt-accelerators-pin-$profileName-$commit"
    $pinPath = Join-Path $Root $pin
    if (Test-Path $pinPath) {
        Note "$pin already there"
    } else {
        Invoke-Git @('-C', $PackRepo, 'worktree', 'add', '-q', '--detach', $pinPath, $commit)
        Note "$pin at $(Get-Git @('-C', $pinPath, 'log', '--oneline', '-1'))"
    }
    $config = Get-Content -Raw 'snagentic.yaml'
    if ($config -match [regex]::Escape("$pin/packs")) {
        Note 'the workspace already points at it'
    } elseif ($config -match '(?m)^accelerators:') {
        $config = $config -replace 'ntt-accelerators-pin-[A-Za-z0-9-]+/packs', "$pin/packs"
        [IO.File]::WriteAllText((Join-Path $workspace 'snagentic.yaml'), $config, (New-Object Text.UTF8Encoding($false)))
        Note "the workspace now points at $pin"
    } else {
        $addition = "accelerators:`n  paths:`n    - ../../$pin/packs`n"
        [IO.File]::AppendAllText((Join-Path $workspace 'snagentic.yaml'), $addition, (New-Object Text.UTF8Encoding($false)))
        Note "the workspace points at $pin"
    }
    & git diff --quiet -- snagentic.yaml
    if ($LASTEXITCODE -ne 0) {
        Invoke-Git @('add', 'snagentic.yaml')
        Invoke-Git @('commit', '-q', '-m', "chore: pin the itsm pack at $commit for $profileName")
    }

    # --- 7. The instance it replaces ----------------------------------------------------------------------------------------------
    if ($replaces) {
        Say "Retiring $replaces, which $profileName replaces"
        Invoke-Retire $replaces $workspace
    }

    # --- 8. Install ---------------------------------------------------------------------------------------------------------------
    Say 'Planning the ITSM install with demo data'
    & $Snagentic accelerator install itsm $profileName --demo | Tee-Object -Variable planLines | Out-Host
    if ($LASTEXITCODE -ne 0) { Die 'planning the install failed (output above)' }
    $planId = ''
    foreach ($line in $planLines) { if ("$line" -match '^Install plan ([0-9a-f]+):') { $planId = $Matches[1]; break } }
    if (-not $planId) { Die 'no plan id in the output above' }
    Note "review: $workspace\accelerators\installs\$profileName\itsm-$planId\plan.md"
    if (Confirm-Yes "Install plan $planId on $instance now? (about 1 to 2 hours on a fresh PDI)") {
        & $Snagentic accelerator install itsm $profileName --demo --confirm $planId
        if ($LASTEXITCODE -ne 0) {
            Note "the install stopped. To resume, run in ${workspace}:"
            Note "  $Snagentic accelerator install itsm $profileName --demo --confirm $planId"
            exit 1
        }
    } else {
        Note "not installed. Later, in ${workspace}:"
        Note "  $Snagentic accelerator install itsm $profileName --demo --confirm $planId"
    }

    Say 'Done'
    Note "workspace  $workspace"
    Note "profile    $profileName ($script:HostName, $username, password in Credential Manager)"
    Note "pack       $pin"
    Note "regression suite 'ACC ITSM regression' runs nightly at 00:30 instance time, or on demand from the browser"
} finally {
    $script:Auth = ''
    $password = ''
}
