#!/bin/sh
# Installs snagentic from a GitHub release, after checking the binary's SHA-256 sum and, when
# the GitHub CLI is installed and signed in, its build provenance (ADR-0043).
#   curl -fsSL https://github.com/caabayfe/agenticsn/releases/latest/download/install.sh | sh
# Environment: SNAGENTIC_VERSION (default: latest), SNAGENTIC_INSTALL_DIR (default:
# ~/.local/bin), SNAGENTIC_DOWNLOAD_BASE (a folder or URL holding the release files).
set -eu

repo="caabayfe/agenticsn"
version="${SNAGENTIC_VERSION:-latest}"
install_dir="${SNAGENTIC_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) target="macos-arm64" ;;
  Linux/x86_64 | Linux/amd64) target="linux-x64" ;;
  Linux/aarch64 | Linux/arm64) target="linux-arm64" ;;
  Darwin/x86_64)
    echo "snagentic does not support Intel Macs (Apple silicon only)" >&2
    exit 1
    ;;
  *)
    echo "snagentic has no build for $(uname -s) $(uname -m); on Windows use install.ps1" >&2
    exit 1
    ;;
esac

# The release's tag, so provenance can be checked against it: the latest one is resolved first.
tag=""
if [ "$version" != "latest" ]; then
  tag="v${version#v}"
elif [ -z "${SNAGENTIC_DOWNLOAD_BASE:-}" ]; then
  tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")"
  tag="${tag##*/}"
fi
if [ -n "${SNAGENTIC_DOWNLOAD_BASE:-}" ]; then
  base="$SNAGENTIC_DOWNLOAD_BASE"
else
  base="https://github.com/$repo/releases/download/$tag"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fsSL "$base/snagentic-$target" -o "$work/snagentic"
curl -fsSL "$base/SHA256SUMS" -o "$work/SHA256SUMS"

expected="$(awk -v name="snagentic-$target" '$2 == name {print $1}' "$work/SHA256SUMS")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$work/snagentic" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$work/snagentic" | awk '{print $1}')"
fi
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "the downloaded snagentic-$target does not match SHA256SUMS; nothing was installed" >&2
  exit 1
fi

# GitHub serves attestations only to signed-in requests, so without gh this is reported, not
# required. A check that runs and fails installs nothing.
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  set -- --repo "$repo" --signer-workflow "$repo/.github/workflows/release.yml"
  if [ -n "$tag" ]; then
    set -- "$@" --source-ref "refs/tags/$tag"
  fi
  if ! GH_PROMPT_DISABLED=1 gh attestation verify "$work/snagentic" "$@" >/dev/null 2>&1; then
    echo "GitHub could not confirm the release workflow built snagentic-$target; nothing was installed" >&2
    echo "check it yourself: gh attestation verify <file> --repo $repo, and report it if it fails" >&2
    exit 1
  fi
  echo "provenance verified: built by the release workflow${tag:+ from $tag}"
else
  echo "provenance not checked (needs the GitHub CLI, signed in); checked against SHA256SUMS only"
fi

mkdir -p "$install_dir"
mv "$work/snagentic" "$install_dir/snagentic"
chmod 755 "$install_dir/snagentic"
echo "installed snagentic in $install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) echo "add it to your PATH: export PATH=\"$install_dir:\$PATH\"" ;;
esac
