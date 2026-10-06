// Public API of the knowledge context.

export { type RefreshOutcome, recordBaseOfPath, refreshIndex } from "./application/refresh-index";
export {
  BEHAVIOR_CLASSES,
  type BehaviorClass,
  behaviorTable,
  orderOf,
  type Phase,
} from "./domain/behavior";
export { type IndexedRecord, indexedRecord, type RecordFields } from "./domain/indexed-record";
export type { CodeHit, IndexMarker, KnowledgeStore, MirrorFiles, SearchQuery } from "./ports";
