// Public API of the documentation context: verified pages and the static site (ADR-0034).

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
  type DocsProblem,
  type EvidenceResult,
} from "./application/check-docs";
export { type Documentation, loadDocumentation } from "./application/load-documentation";
export { type PinDocsQuery, type PinDocsResult, pinDocs } from "./application/pin-docs";
export { base64 } from "./domain/base64";
export { DocumentationSourceError, NoDocumentationError } from "./domain/errors";
export {
  anchorHash,
  anchorOf,
  type Evidence,
  type EvidenceStatus,
  evidenceStatus,
  type MirrorRecord,
  parseEvidence,
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
  AUDIENCES,
  type Audience,
  citationsOf,
  type DocPage,
  type PageProblem,
  pageProblems,
  parseDocPage,
  proseOf,
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
  transcriptHtml,
} from "./domain/prose";
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
export { parseSiteConfig, type SiteConfig } from "./domain/site-config";
export { pageFile } from "./domain/site-layout";
export { SAMPLE_RATE, SYNTH_SOUND_NAMES, synthBed, synthSound } from "./domain/synth";
export type {
  AudioAssets,
  AudioCodec,
  DocumentationSources,
  MarkdownRenderer,
  MediaTools,
  MirrorRecords,
  PageSource,
  SceneSource,
  SiteOutput,
  VoiceSynthesizer,
} from "./ports";
