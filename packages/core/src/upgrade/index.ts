// Public API of the upgrade context: `snagentic upgrade` and the update notice (ADR-0023).

export { type UpdateNoticeDependencies, updateNotice } from "./application/update-notice";
export {
  type UpgradeDependencies,
  type UpgradeQuery,
  type UpgradeResult,
  upgrade,
} from "./application/upgrade";
export {
  BinaryNotReplacedError,
  ChecksumMismatchError,
  NoBuildForPlatformError,
  NotAnInstalledBinaryError,
  ReleaseUnavailableError,
} from "./domain/errors";
export { checkDue, type NoticeSurface, noticeAllowed, noticeText } from "./domain/notice";
export {
  assetName,
  expectedSum,
  type ReleaseNotes,
  sha256Hex,
  upgradeSteps,
} from "./domain/release";
export { compareVersions, parseVersion } from "./domain/version";
export type {
  InstalledBinary,
  ReleaseInfo,
  ReleaseSource,
  UpdateCheck,
  UpdateCheckStore,
} from "./ports";
