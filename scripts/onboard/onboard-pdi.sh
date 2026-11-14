#!/usr/bin/env bash
# Onboards a ServiceNow PDI for the ITSM accelerator, from an empty workspace to the installed pack:
#   1. asks for the instance, a profile name, the user and the password (never echoed, never written to disk);
#   2. checks the instance is awake and that REST accepts the user (Brazil refuses Basic auth without snc_basic_auth_api_access);
#   3. creates the workspace spaces/<profile>-<instance>, adds the profile, stores the password in the keychain (snagentic auth login);
#   4. marks the instance for the pack's regression (nttdata.acc.regression.instance_kind = development:<instance_name>);
#   5. runs snagentic doctor, the first pull and integrate;
#   6. pins the pack at a commit in a detached worktree (ntt-accelerators-pin-<profile>-<commit>) and points the workspace at it;
#   7. where the instance replaces another one, retires that one after you say yes: forgets its password, moves its workspace to
#      spaces-archive/<date>/ and removes its pack pins (a pin with local changes or a commit no branch holds is kept);
#   8. plans the ITSM install with demo data and, after you say yes, runs it.
# Run it again with the same answers to continue after a failure: the steps already done are skipped.
#
#   scripts/onboard/onboard-pdi.sh
#   scripts/onboard/onboard-pdi.sh --retire pdi7                    # only retire a profile, onboard nothing
#   SNAGENTIC=/path/to/snagentic scripts/onboard/onboard-pdi.sh     # another snagentic build
#   ONBOARD_ROOT=/path/to/folder scripts/onboard/onboard-pdi.sh     # where ntt-accelerators and spaces/ live
#
# For the generic steps (workspace, profile, sign-in, check, pull, integrate) `snagentic onboard` does the
# same on every platform (ADR-0056); this script adds the accelerator team's pack pin, regression mark,
# retiring a replaced profile and the ITSM install.
set -euo pipefail

# The folder that holds the sn-accelerators clone (ntt-accelerators), the spaces/ workspaces and the
# pack pins: by default the folder that holds this repository. ONBOARD_ROOT names another.
ROOT="${ONBOARD_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
SNAGENTIC="${SNAGENTIC:-$HOME/bin/snagentic}"
PACK_REPO="$ROOT/ntt-accelerators"
SPACES="$ROOT/spaces"
DEFAULT_REF="origin/audit/round-2"

PASSWORD=""
CURL_USER=""
trap 'PASSWORD=""; CURL_USER=""' EXIT

say() { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() {
    printf '\nonboard: %s\n' "$*" >&2
    exit 1
}
ask() {
    local reply
    read -r -p "$1${2:+ [$2]}: " reply
    printf '%s' "${reply:-${2:-}}"
}
confirm() {
    local reply
    read -r -p "$1 [y/N]: " reply
    [[ $reply == y || $reply == Y ]]
}

# A REST call as the user: the password reaches curl through a config on a file descriptor, never on the command line. Prints the body,
# then the HTTP status on its own last line.
api() {
    local method=$1 path=$2 data=${3:-}
    local args=(-sS -X "$method" -H 'Accept: application/json' -w '\n%{http_code}' "https://$HOST$path")
    [[ -n $data ]] && args+=(-H 'Content-Type: application/json' -d "$data")
    curl -K <(printf 'user = "%s"\n' "$CURL_USER") "${args[@]}" || printf '\n000'
}

# The value of a JSON path in the body (python3, part of macOS), or ''.
json() {
    python3 -c 'import json,sys
try:
    v = json.load(sys.stdin)
    for k in sys.argv[1].split("."):
        v = v[int(k)] if isinstance(v, list) else v[k]
    print(v)
except Exception:
    print("")' "$1"
}

# Retires a profile once you say yes: forgets its password, archives its workspaces, removes its pack pins. Nothing on the instance is
# touched, no branch is deleted, and a pin holding work found nowhere else is kept.
retire() {
    local old=$1 keep=${2:-} item archive
    local spaces=() pins=()
    for item in "$SPACES/$old" "$SPACES/$old"-*; do
        [[ -f $item/instances/$old/instance.yaml && $item != "$keep" ]] && spaces+=("$item")
    done
    for item in "$ROOT/ntt-accelerators-pin-$old" "$ROOT/ntt-accelerators-pin-$old"-*; do
        [[ -d $item ]] && pins+=("$item")
    done
    if ((${#spaces[@]} + ${#pins[@]} == 0)); then
        note "nothing of $old found: no workspace in $SPACES, no pack pin"
        return 0
    fi
    archive="$ROOT/spaces-archive/$(date +%F)"
    note "retiring $old would:"
    for item in ${spaces[@]+"${spaces[@]}"}; do
        note "  forget its password in the keychain, and move $item to $archive/"
    done
    for item in ${pins[@]+"${pins[@]}"}; do
        note "  remove the pack pin $item"
    done
    confirm "Retire $old now?" || {
        note "$old kept as it is"
        return 0
    }
    for item in ${spaces[@]+"${spaces[@]}"}; do
        (cd "$item" && "$SNAGENTIC" auth logout "$old") || note "  the password of $old could not be removed (already gone?)"
        mkdir -p "$archive"
        if [[ -e $archive/$(basename "$item") ]]; then
            note "  $archive/$(basename "$item") already exists: $item left where it is"
        else
            mv "$item" "$archive/"
            note "  moved $(basename "$item") to $archive/"
        fi
    done
    for item in ${pins[@]+"${pins[@]}"}; do
        if [[ -n $(git -C "$item" status --porcelain 2>/dev/null) ]]; then
            note "  kept $(basename "$item"): it has local changes"
        elif [[ -z $(git -C "$item" for-each-ref --contains HEAD --format='%(refname)' refs/heads refs/remotes 2>/dev/null) ]]; then
            note "  kept $(basename "$item"): its commit is on no branch"
        elif git -C "$PACK_REPO" worktree remove "$item" 2>/dev/null; then
            note "  removed $(basename "$item")"
        else
            note "  kept $(basename "$item"): git would not remove it"
        fi
    done
}

# --- 0. Tools ------------------------------------------------------------------------------------------------------------------------
[[ -x $SNAGENTIC ]] || die "no snagentic at $SNAGENTIC (set SNAGENTIC=/path/to/snagentic)"
command -v git >/dev/null || die "git is missing"
command -v curl >/dev/null || die "curl is missing"
command -v python3 >/dev/null || die "python3 is missing"
[[ -d $PACK_REPO/.git ]] || die "no sn-accelerators clone at $PACK_REPO"

if [[ ${1:-} == --retire ]]; then
    [[ ${2:-} =~ ^[a-z][a-z0-9-]*$ ]] || die "usage: $0 --retire <profile>"
    say "Retiring $2"
    retire "$2"
    exit 0
fi
[[ $# -eq 0 ]] || die "usage: $0 [--retire <profile>]"

# --- 1. Questions ----------------------------------------------------------------------------------------------------------------------
say "The instance"
RAW=$(ask "Instance (dev12345 or its https address)")
INSTANCE=$(printf '%s' "$RAW" | sed -E 's#^https?://##; s#\.service-now\.com.*$##; s#/.*$##')
[[ $INSTANCE =~ ^[a-z0-9-]+$ ]] || die "not an instance name: $RAW"
HOST="$INSTANCE.service-now.com"
PROFILE=$(ask "Profile name, short (pdi7)")
[[ $PROFILE =~ ^[a-z][a-z0-9-]*$ ]] || die "a profile name is lower case letters, digits and dashes: $PROFILE"
USERNAME=$(ask "User" "admin")
read -r -s -p "Password for $USERNAME on $HOST (not shown): " PASSWORD
printf '\n'
[[ -n $PASSWORD ]] || die "no password given"
ESCAPED=$(printf '%s:%s' "$USERNAME" "$PASSWORD" | sed 's/\\/\\\\/g; s/"/\\"/g')
CURL_USER=$ESCAPED
REF=$(ask "Pack commit or branch to install" "$DEFAULT_REF")
REPLACES=$(ask "Profile this instance replaces, retired once this one is pulled (empty: none)")
[[ -z $REPLACES || $REPLACES =~ ^[a-z][a-z0-9-]*$ ]] || die "not a profile name: $REPLACES"
[[ $REPLACES != "$PROFILE" ]] || die "an instance cannot replace itself: give the old profile's name, or nothing"
WORKSPACE="$SPACES/$PROFILE-$INSTANCE"
note "workspace: $WORKSPACE"

# --- 2. Awake, and REST accepts the user ---------------------------------------------------------------------------------------------
say "Checking $HOST"
while :; do
    RESPONSE=$(api GET '/api/now/table/sys_properties?sysparm_query=name%3Dinstance_name&sysparm_fields=value&sysparm_limit=1')
    STATUS=${RESPONSE##*$'\n'}
    BODY=${RESPONSE%$'\n'*}
    INSTANCE_NAME=$(printf '%s' "$BODY" | json result.0.value)
    if [[ $STATUS == 200 && -n $INSTANCE_NAME ]]; then
        note "awake; instance_name is $INSTANCE_NAME"
        break
    elif [[ $STATUS == 401 ]]; then
        note "REST refused $USERNAME (401). Either the password is wrong, or, on Brazil, the user lacks the role"
        note "snc_basic_auth_api_access. In the browser, as $USERNAME: open"
        note "  https://$HOST/sys_user_list.do?sysparm_query=user_name%3D$USERNAME"
        note "then Roles > Edit > add snc_basic_auth_api_access, and save."
    elif [[ $STATUS == 200 || $STATUS == 000 || $STATUS == 5* || $STATUS == 3* ]]; then
        note "no answer from the instance's API (HTTP $STATUS): the PDI is probably asleep or waking up."
        note "Wake it at https://developer.servicenow.com (Manage > Instance), wait until it opens in the browser."
    else
        note "unexpected answer (HTTP $STATUS): $(printf '%s' "$BODY" | head -c 300)"
    fi
    confirm "Check again?" || die "stopped: the instance is not reachable as $USERNAME"
done

# --- 3. Workspace, profile, keychain -------------------------------------------------------------------------------------------------
say "Workspace"
if [[ -f $WORKSPACE/snagentic.yaml ]]; then
    note "already there: continuing in it"
else
    [[ -e $WORKSPACE ]] && die "$WORKSPACE exists but is not a snagentic workspace: move it away first"
    "$SNAGENTIC" init "$WORKSPACE"
fi
cd "$WORKSPACE"

if [[ -f instances/$PROFILE/instance.yaml ]]; then
    grep -q "$HOST" "instances/$PROFILE/instance.yaml" || die "profile $PROFILE already names another instance: pick another profile name"
    note "profile $PROFILE already added"
else
    "$SNAGENTIC" instance add "$PROFILE" --url "$INSTANCE" --username "$USERNAME" --kind development
fi

say "Storing the password in the keychain (macOS may ask to allow snagentic: choose Always Allow)"
printf '%s' "$PASSWORD" | "$SNAGENTIC" auth login "$PROFILE"

# --- 4. Regression mark --------------------------------------------------------------------------------------------------------------
say "Marking the instance for the pack's regression"
MARK="development:$INSTANCE_NAME"
RESPONSE=$(api GET '/api/now/table/sys_properties?sysparm_query=name%3Dnttdata.acc.regression.instance_kind&sysparm_fields=sys_id,value&sysparm_limit=1')
BODY=${RESPONSE%$'\n'*}
MARK_ID=$(printf '%s' "$BODY" | json result.0.sys_id)
MARK_NOW=$(printf '%s' "$BODY" | json result.0.value)
if [[ $MARK_NOW == "$MARK" ]]; then
    note "already $MARK"
else
    if [[ -n $MARK_ID ]]; then
        RESPONSE=$(api PATCH "/api/now/table/sys_properties/$MARK_ID" "{\"value\":\"$MARK\"}")
    else
        RESPONSE=$(api POST '/api/now/table/sys_properties' "{\"name\":\"nttdata.acc.regression.instance_kind\",\"value\":\"$MARK\",\"type\":\"string\",\"description\":\"The pack's regression runs here: development or test, with this instance's name. Never on production.\"}")
    fi
    STATUS=${RESPONSE##*$'\n'}
    [[ $STATUS == 200 || $STATUS == 201 ]] || die "could not set nttdata.acc.regression.instance_kind (HTTP $STATUS)"
    note "set to $MARK"
fi

# --- 5. Doctor, first pull ------------------------------------------------------------------------------------------------------------
say "snagentic doctor"
"$SNAGENTIC" doctor --instance "$PROFILE" || confirm "doctor reported problems (above). Continue anyway?" || die "stopped after doctor"

say "First pull and integrate (long on a fresh instance; resumable: run this script again if it stops)"
"$SNAGENTIC" pull "$PROFILE"
"$SNAGENTIC" integrate "$PROFILE"

# --- 6. Pack pin ---------------------------------------------------------------------------------------------------------------------
say "Pinning the pack"
git -C "$PACK_REPO" fetch -q origin
COMMIT=$(git -C "$PACK_REPO" rev-parse --short=8 "$REF^{commit}") || die "no commit $REF in $PACK_REPO"
PIN="ntt-accelerators-pin-$PROFILE-$COMMIT"
if [[ -d $ROOT/$PIN ]]; then
    note "$PIN already there"
else
    git -C "$PACK_REPO" worktree add -q --detach "$ROOT/$PIN" "$COMMIT"
    note "$PIN at $(git -C "$ROOT/$PIN" log --oneline -1)"
fi
if grep -q "$PIN/packs" snagentic.yaml; then
    note "the workspace already points at it"
elif grep -q '^accelerators:' snagentic.yaml; then
    sed -i '' -E "s#ntt-accelerators-pin-[A-Za-z0-9-]+/packs#$PIN/packs#" snagentic.yaml
    note "the workspace now points at $PIN"
else
    printf 'accelerators:\n  paths:\n    - ../../%s/packs\n' "$PIN" >>snagentic.yaml
    note "the workspace points at $PIN"
fi
if ! git diff --quiet -- snagentic.yaml; then
    git add snagentic.yaml
    git commit -q -m "chore: pin the itsm pack at $COMMIT for $PROFILE"
fi

# --- 7. The instance it replaces -----------------------------------------------------------------------------------------------------
if [[ -n $REPLACES ]]; then
    say "Retiring $REPLACES, which $PROFILE replaces"
    retire "$REPLACES" "$WORKSPACE"
fi

# --- 8. Install ----------------------------------------------------------------------------------------------------------------------
say "Planning the ITSM install with demo data"
PLAN_LOG=$(mktemp)
"$SNAGENTIC" accelerator install itsm "$PROFILE" --demo | tee "$PLAN_LOG"
PLAN=$(sed -nE 's/^Install plan ([0-9a-f]+):.*/\1/p' "$PLAN_LOG" | head -1)
rm -f "$PLAN_LOG"
[[ -n $PLAN ]] || die "no plan id in the output above"
note "review: $WORKSPACE/accelerators/installs/$PROFILE/itsm-$PLAN/plan.md"
if confirm "Install plan $PLAN on $INSTANCE now? (about 1 to 2 hours on a fresh PDI)"; then
    if ! "$SNAGENTIC" accelerator install itsm "$PROFILE" --demo --confirm "$PLAN"; then
        note "the install stopped. To resume, run in $WORKSPACE:"
        note "  $SNAGENTIC accelerator install itsm $PROFILE --demo --confirm $PLAN"
        exit 1
    fi
else
    note "not installed. Later, in $WORKSPACE:"
    note "  $SNAGENTIC accelerator install itsm $PROFILE --demo --confirm $PLAN"
fi

say "Done"
note "workspace  $WORKSPACE"
note "profile    $PROFILE ($HOST, $USERNAME, password in the keychain)"
note "pack       $PIN"
note "regression suite 'ACC ITSM regression' runs nightly at 00:30 instance time, or on demand from the browser"
