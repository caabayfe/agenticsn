import { SnagenticError } from "../../kernel/errors";

export class NotAnInstalledBinaryError extends SnagenticError {
  constructor() {
    super(
      "not-an-installed-binary",
      "precondition",
      "snagentic is running from source, not from an installed release, so there is nothing to replace",
      "install a release with install.sh (or install.ps1), or rebuild with bun run build",
    );
  }
}

export class NoBuildForPlatformError extends SnagenticError {
  constructor(platform: string, arch: string) {
    super(
      "no-build-for-platform",
      "precondition",
      `releases have no snagentic build for ${platform} ${arch}`,
      "see the supported platforms in docs/getting-started.md",
    );
  }
}

export class ReleaseUnavailableError extends SnagenticError {
  constructor(what: string, reason: string) {
    super(
      "release-unavailable",
      "remote",
      `could not get ${what}: ${reason}`,
      "check your connection and try again, or download it from https://github.com/caabayfe/agenticsn/releases",
    );
  }
}

export class ChecksumMismatchError extends SnagenticError {
  constructor(asset: string, version: string) {
    super(
      "checksum-mismatch",
      "remote",
      `the downloaded ${asset} of ${version} does not match its SHA256SUMS; nothing was replaced`,
      "try again later; if it persists, report it, since the release files may have been tampered with",
    );
  }
}

export class BinaryNotReplacedError extends SnagenticError {
  constructor(path: string, reason: string) {
    super(
      "binary-not-replaced",
      "precondition",
      `could not replace ${path}: ${reason}; the installed version still works`,
      "check you can write to that folder, or install with install.sh into a folder you own",
    );
  }
}
