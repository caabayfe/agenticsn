#!/usr/bin/env bash
# CI only: puts a pinned static ffmpeg on the PATH for the documentation media tests (ADR-0036),
# instead of installing it from the Ubuntu mirror, which stalled whole jobs (2026-10-22).
# The build is checked against its SHA-256 when downloaded, and the binary on every run, so a
# cache entry is trusted only if it still holds exactly that binary.
#   scripts/ci/ffmpeg.sh <directory>     (the directory actions/cache restores)
set -euo pipefail

# eugeneware/ffmpeg-static b6.1.1: a static ffmpeg 7.0.2 (libx264, libmp3lame, native AAC).
URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz"
ARCHIVE_SHA256="bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa"
BINARY_SHA256="e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99"

dir="$1"
mkdir -p "$dir"
if ! echo "$BINARY_SHA256  $dir/ffmpeg" | sha256sum -c --status - 2>/dev/null; then
  curl -fsSL --retry 3 --max-time 120 -o "$dir/ffmpeg.gz" "$URL"
  echo "$ARCHIVE_SHA256  $dir/ffmpeg.gz" | sha256sum -c -
  gunzip -f "$dir/ffmpeg.gz"
  echo "$BINARY_SHA256  $dir/ffmpeg" | sha256sum -c -
fi
chmod +x "$dir/ffmpeg"
echo "$dir" >> "$GITHUB_PATH"
"$dir/ffmpeg" -hide_banner -version | head -1
