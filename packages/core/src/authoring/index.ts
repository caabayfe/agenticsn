// Public API of the authoring context (ADR-0031, ADR-0033): built units, their comparison with
// the instance, the ledger and the decision plan makes for each unit.

export {
  type AdoptDependencies,
  type AdoptedUnit,
  type AdoptResult,
  adopt,
} from "./application/adopt";
export { readUnits } from "./application/read-units";
export {
  type TakenRecord,
  type TakeOverDependencies,
  type TakeOverInput,
  type TakeOverResult,
  takeOver,
} from "./application/take-over";
export {
  AdoptRecordsNotFoundError,
  AdoptRefusedError,
  AdoptSecretError,
  AdoptStoreApplicationError,
  AdoptTransformFailedError,
  AdoptUnexplainedDifferenceError,
  InvalidRecordReferenceError,
  InvalidScopeNameError,
  LedgerUncommittedError,
  NothingAdoptedError,
  PathOutsideProjectError,
  SdkUnavailableError,
  TakeOverBuildFailedError,
} from "./domain/adopt-errors";
export {
  capturedContentAgrees,
  capturedContentDifferences,
  compiledCopyAgrees,
  compiledCopyDifferences,
  draftContentAgrees,
  publishedCapture,
} from "./domain/capture-content";
export { compareUnit, type Difference } from "./domain/compare";
export {
  CONVERSION_FIXES_SDK_VERSION,
  type ConversionOutcome,
  fixConverted,
} from "./domain/conversion-fixes";
export type { PendingDelivery } from "./domain/delivery-receipt";
export { unitDigest } from "./domain/digest";
export { driftedUnits, type PulledRecord } from "./domain/drift";
export { SdkRouteRefusedError, UnreadableBuildError } from "./domain/errors";
export {
  EMPTY_LEDGER,
  InvalidLedgerError,
  LEDGER_FILE,
  type Ledger,
  type LedgerEntry,
  ledgerDocument,
  ledgerOf,
  withEntries,
} from "./domain/ledger";
export {
  knownLoss,
  LOSS_DESCRIPTIONS,
  LOSSES_SDK_VERSION,
  type LossId,
} from "./domain/losses";
export {
  NATIVE_TRIGGER_TYPES,
  type NativeTriggerContract,
  TRIGGER_OUTPUT_FIELDS,
} from "./domain/native-trigger-capture";
export {
  ABANDON_PENDING_EXIT,
  isKeyedDeletion,
  pendingDecision,
  pendingFor,
  RECOVERY_GUIDE,
} from "./domain/pending-delivery";
export { planUnit, type UnitDecision } from "./domain/plan-unit";
export { conversionRefusal, knownRefusal } from "./domain/refusals";
export { ledgerEntryOf } from "./domain/renamed-units";
export { sdkRouteAllowed } from "./domain/sdk-routes";
export {
  type BuiltUnit,
  type Fields,
  type InstanceCopy,
  isDeletion,
  type UnitAction,
  type UnitRecord,
} from "./domain/unit";
export { draftFileSecrets, unitSecrets } from "./domain/unit-secrets";
export {
  type ChildSpec,
  childLink,
  coalesceValues,
  type UnitSpec,
  unitSpec,
} from "./domain/unit-specs";
export { VERSION_FIELDS, versionOf } from "./domain/unit-version";
export {
  comparedValue,
  isNamedReference,
  keyedReference,
  keyedValue,
  NAMED_REFERENCES,
  normalizeValue,
  sameValue,
} from "./domain/values";
export type {
  AuthoringWorkspace,
  BuildOutcome,
  DraftOutcome,
  FluentToolchain,
  SdkAccess,
  SourceDraft,
  SourceProject,
  TransformTarget,
} from "./ports";
