// Public API of the knowledge context.

export {
  describeRecord,
  type RecordDescription,
  RecordNotFoundError,
  type UsedBy,
} from "./application/describe-record";
export {
  type BehaviorItem,
  describeTable,
  type FieldItem,
  PHASE_ORDER,
  type TableDescription,
} from "./application/describe-table";
export { type FindQuery, type FindResult, type FoundRecord, find } from "./application/find";
export { freshness, STALE_AFTER_MINUTES } from "./application/freshness";
export type {
  Freshness,
  KnowledgeDependencies,
  NextCall,
} from "./application/knowledge-dependencies";
export { type RefreshOutcome, refreshIndex } from "./application/refresh-index";
export {
  BEHAVIOR_CLASSES,
  type BehaviorClass,
  behaviorTable,
  orderOf,
  type Phase,
} from "./domain/behavior";
export { type IndexedRecord, indexedRecord, type RecordFields } from "./domain/indexed-record";
export { baseOfFile, recordBaseOfPath } from "./domain/paths";
export type {
  CodeHit,
  GrepOptions,
  IndexMarker,
  KnowledgeStore,
  MirrorFiles,
  SearchQuery,
} from "./ports";
