import { DocumentationSourceError } from "./errors";
import { fieldsOf, textOf } from "./fields";

export type Camera = readonly [scale: number, x: number, y: number];

// One step of an animation: title, caption (HTML), narration, subtitle, camera, and an
// optional script run when the step starts (author content, run only in the sandboxed player).
export interface SceneStep {
  readonly t: string;
  readonly c: string;
  readonly say: string;
  readonly sub: string;
  readonly cam?: Camera;
  readonly on?: string;
}

export const TAG_KINDS = ["obs", "con", "src"] as const;
export type TagKind = (typeof TAG_KINDS)[number];

export interface Scene {
  readonly name: string;
  readonly title: string;
  readonly heading: string;
  readonly tags: readonly { readonly kind: TagKind; readonly text: string }[];
  readonly vb: readonly [number, number];
  readonly foot: string;
  readonly svg: string;
  readonly css: string;
  readonly steps: readonly SceneStep[];
}

export interface Timeline {
  readonly starts: readonly number[];
  readonly total: number;
}

const DEFAULT_VIEWBOX: readonly [number, number] = [960, 440];
const NAME = /^[a-z0-9]+$/;

const isNumbers = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every((n) => typeof n === "number");

function camera(path: string, index: number, raw: unknown): Camera | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!isNumbers(raw, 3)) {
    throw new DocumentationSourceError(path, `step ${index + 1}: cam must be [scale, x, y]`);
  }
  return [raw[0] ?? 1, raw[1] ?? 0, raw[2] ?? 0];
}

function step(path: string, index: number, raw: unknown): SceneStep {
  const item = fieldsOf(raw);
  const need = (name: string) => {
    const value = textOf(item[name]);
    if (value === undefined) {
      throw new DocumentationSourceError(path, `step ${index + 1} needs ${name}`);
    }
    return value;
  };
  const say = need("say");
  const cam = camera(path, index, item["cam"]);
  const on = textOf(item["on"]);
  if (on?.includes("</")) {
    throw new DocumentationSourceError(path, `step ${index + 1}: on must not contain </`);
  }
  return {
    t: need("t"),
    c: need("c"),
    say,
    sub: textOf(item["sub"]) ?? say,
    ...(cam === undefined ? {} : { cam }),
    ...(on === undefined ? {} : { on }),
  };
}

function tags(path: string, raw: unknown): Scene["tags"] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new DocumentationSourceError(path, "tags must be a list of [kind, text]");
  }
  return raw.map((tag) => {
    const [kind, text] = Array.isArray(tag) ? tag : [];
    const known = TAG_KINDS.find((candidate) => candidate === kind);
    if (known === undefined || typeof text !== "string") {
      throw new DocumentationSourceError(path, "each tag is [obs|con|src, text]");
    }
    return { kind: known, text };
  });
}

// `path` is the animation's folder relative to documentation/ (animations/<name>).
export function parseScene(
  path: string,
  files: {
    readonly animation: unknown;
    readonly svg: string;
    readonly css: string | null;
    readonly steps: unknown;
  },
): Scene {
  const meta = fieldsOf(files.animation);
  const folder = path.slice(path.lastIndexOf("/") + 1);
  const name = textOf(meta["name"]);
  if (name !== folder || !NAME.test(name)) {
    throw new DocumentationSourceError(
      path,
      `animation.json name must be the folder name, ${folder} ([a-z0-9]+)`,
    );
  }
  if (!files.svg.includes('id="cam"')) {
    throw new DocumentationSourceError(path, 'scene.svg needs the camera group <g id="cam">');
  }
  if (!Array.isArray(files.steps) || files.steps.length === 0) {
    throw new DocumentationSourceError(path, "steps.json needs at least one step");
  }
  const vb = meta["vb"];
  return {
    name,
    title: textOf(meta["title"]) ?? name,
    heading: textOf(meta["heading"]) ?? "",
    tags: tags(path, meta["tags"]),
    vb: isNumbers(vb, 2) ? [vb[0] ?? 960, vb[1] ?? 440] : DEFAULT_VIEWBOX,
    foot: textOf(meta["foot"]) ?? "",
    svg: files.svg,
    css: files.css ?? "",
    steps: files.steps.map((raw, index) => step(path, index, raw)),
  };
}

const words = (text: string) => text.split(/\s+/).filter((word) => word !== "").length;

// The player's clock without narration (the original engine's estimate).
export function estimateTimeline(steps: readonly SceneStep[]): Timeline {
  const starts: number[] = [];
  let at = 0.6;
  for (const item of steps) {
    starts.push(at);
    at += Math.max(4.2, words(item.say) / 2.55 + 1.5);
  }
  return { starts, total: at + 1.6 };
}
