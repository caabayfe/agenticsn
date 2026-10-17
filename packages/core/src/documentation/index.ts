// Public API of the documentation context: verified pages and the static site (ADR-0036).

export { type AudioOptions, type AudioTrack, audioTrack } from "./application/audio-tracks";
export {
  type BuildSiteDependencies,
  type BuildSiteOptions,
  type BuildSiteResult,
  buildSite,
} from "./application/build-site";
export {
  assessDocumentation,
  type CheckDocsDependencies,
  checkDocs,
  type DocsCheck,
  type EvidenceResult,
} from "./application/check-docs";
export { configIndex } from "./application/config-index";
export {
  type DocumentationLookup,
  documentationLookup,
} from "./application/documented-records";
export { type Documentation, loadDocumentation } from "./application/load-documentation";
export { type PinDocsQuery, type PinDocsResult, pinDocs } from "./application/pin-docs";
export {
  type RenderVideoDependencies,
  type RenderVideoQuery,
  type RenderVideoResult,
  renderVideo,
} from "./application/render-video";
export {
  checkedOnSurface,
  platformWords,
  SURFACE_TABLES,
} from "./domain/audience-checks";
export { base64 } from "./domain/base64";
export {
  appliesTo,
  CONFIG_RECORD_TYPES,
  type ConfigIndex,
  type ConfigRecordType,
  groupByType,
  type IndexEntry,
  recordDetails,
  recordName,
  worstStatus,
} from "./domain/config-index";
export { DocumentationSourceError, NoDocumentationError } from "./domain/errors";
export {
  anchorHash,
  anchorOf,
  type Evidence,
  type EvidenceStatus,
  evidenceStatus,
  type MirrorRecord,
  parseEvidence,
  type RecordEvidence,
  SEEN_RECHECK_DAYS,
  type SeenEvidence,
  seenStatus,
} from "./domain/evidence";
export { escapeHtml, scriptJson } from "./domain/html";
export { MediaToolMissingError, UnknownVoiceError } from "./domain/media-errors";
export {
  dbToGain,
  duckEnvelope,
  MIX,
  type MixInput,
  type MixResult,
  mixTrack,
  rmsNormalize,
} from "./domain/mix";
export {
  citationsOf,
  type DocPage,
  type PageProblem,
  pageProblems,
  parseDocPage,
  proseOf,
  SECTIONS,
  type Section,
  splitFrontMatter,
} from "./domain/page";
export { type PlayerAudio, type PlayerMedia, playerHtml, revealCss } from "./domain/player";
export {
  type LifecycleState,
  OVERVIEW,
  type Process,
  type ProcessCapability,
  type ProcessRole,
  parseProcess,
} from "./domain/process";
export {
  animationsOf,
  expandProse,
  LABELS,
  type Label,
  mapProse,
  SEE_LINK,
  transcriptHtml,
} from "./domain/prose";
export { type Resolved, referencesOf, resolveReference } from "./domain/references";
export {
  type Camera,
  type Cue,
  estimateTimeline,
  parseScene,
  type Scene,
  type SceneStep,
  TAG_KINDS,
  type TagKind,
  type Timeline,
} from "./domain/scene";
export { type SiteFile, type SiteInput, siteFiles } from "./domain/site";
export { parseSiteConfig, type SiteConfig, type Surface } from "./domain/site-config";
export { pageFile, sectionHome } from "./domain/site-layout";
export {
  capabilityAudience,
  DOCS_PROBLEM_KINDS,
  type DocSet,
  type DocsProblem,
  type DocsProblemKind,
  docsProblem,
  SECTION_VIEW,
  structureProblems,
} from "./domain/structure";
export { SAMPLE_RATE, SYNTH_SOUND_NAMES, synthBed, synthSound } from "./domain/synth";
export { type CapturedFrame, concatList, type FrameEntry, frameSchedule } from "./domain/video";
export { isView, VIEWS, type View, viewMarks, viewOf } from "./domain/views";
export type {
  AudioAssets,
  AudioCodec,
  DocumentationSources,
  MarkdownRenderer,
  MediaTools,
  MirrorListing,
  MirrorRecords,
  PageSource,
  SceneSource,
  SiteOutput,
  VideoOptions,
  VideoOutput,
  VideoRenderer,
  VoiceSynthesizer,
} from "./ports";
