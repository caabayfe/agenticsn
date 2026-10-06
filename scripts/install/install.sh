#!/bin/sh
# Installs snagentic from a GitHub release, after checking the binary's SHA-256 sum.
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

if [ -n "${SNAGENTIC_DOWNLOAD_BASE:-}" ]; then
  base="$SNAGENTIC_DOWNLOAD_BASE"
elif [ "$version" = "latest" ]; then
  base="https://github.com/$repo/releases/latest/download"
else
  base="https://github.com/$repo/releases/download/v${version#v}"
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

mkdir -p "$install_dir"
mv "$work/snagentic" "$install_dir/snagentic"
chmod 755 "$install_dir/snagentic"
echo "installed snagentic in $install_dir"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) echo "add it to your PATH: export PATH=\"$install_dir:\$PATH\"" ;;
esac
