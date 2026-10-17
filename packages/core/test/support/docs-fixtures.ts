import { createHash } from "node:crypto";
import type {
  DocumentationSources,
  MediaTools,
  MirrorRecord,
  MirrorRecords,
  PageSource,
  SceneSource,
} from "@snagentic/core";

export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

export const RULE = "0c1345dd0783f01028ef0a701ad300fa";
export const PRODUCER = "3f1dd0a0c0a8010e0128ef1a8b5f1a58";
export const LIST = "8a2e7e1fc3a31110ec3f1d0d05013152";
export const ACTION = "2f43c471c0a8000b00a5f8f3a1d00a41";
export const SCRIPT = "function onBefore() { current.assignment_group = group; }";

export const SITE = {
  title: "Incident docs",
  instance: "pdi2",
  footer: "Prepared with snagentic.",
  surfaces: {
    user: [{ id: "employee-center", name: "Employee Center" }],
    operator: ["Service Operations Workspace", "classic form"],
  },
  vocabulary: ["work notes"],
};

export const PROCESS = {
  title: "Incident management",
  summary: "Get people working again as fast as possible.",
  order: 1,
  roles: [
    { id: "caller", name: "Caller", audience: "user", description: "anyone who reports a problem" },
    { id: "agent", name: "Service desk agent", audience: "operator" },
    { id: "resolver", name: "Resolver", audience: "operator" },
  ],
  lifecycle: [
    { state: "New", meaning: "logged, nobody working on it yet" },
    { state: "In Progress", meaning: "someone is working on it" },
  ],
  understand: ["overview", "lifecycle"],
  capabilities: [
    { id: "report", title: "Report an incident", summary: "Tell us.", roles: ["caller"] },
    { id: "assign", title: "Assign an incident", summary: "Route it.", roles: ["agent"] },
    {
      id: "resolve",
      title: "Resolve an incident",
      summary: "Record the fix.",
      roles: ["resolver"],
      counterpart: "confirm",
    },
    {
      id: "confirm",
      title: "Confirm or reopen the fix",
      summary: "Say whether it works.",
      roles: ["caller"],
      counterpart: "resolve",
      configure: "resolve",
    },
  ],
};

const record = (table: string, sysId: string, how: string, extra = {}) => ({
  record: `${table}/${sysId}`,
  how,
  result: "as described",
  ...extra,
});

export const SEEN = {
  seen: { by: "A. Reviewer", on: "2026-10-01", where: "Employee Center › My Requests" },
  how: "opened a resolved request",
  result: "shows Accept and Reject",
};

export const pages = {
  overview: {
    path: "processes/incident/understand/overview.md",
    frontMatter: { title: "How incident management works" },
    body: "Something broke.\n\n## Where you see it {for=user}\n\nIn Employee Center.\n\n## Where you see it {for=operator}\n\nIn the workspace; the assignment_group field routes it.\n",
  },
  lifecycle: {
    path: "processes/incident/understand/lifecycle.md",
    frontMatter: { title: "The life of an incident" },
    body: "New, then In Progress.",
  },
  report: {
    path: "processes/incident/use/report.md",
    frontMatter: {
      title: "Report an incident",
      evidence: {
        E01: record("sc_cat_item_producer", PRODUCER, "read the producer", { hash: "p1" }),
      },
    },
    body: "Open Employee Center and choose Report an issue. [E01]",
  },
  confirm: {
    path: "processes/incident/use/confirm.md",
    frontMatter: { title: "Confirm or reopen the fix", evidence: { E01: SEEN } },
    body: "Accept it, or reject it with a reason. [E01]",
  },
  assign: {
    path: "processes/incident/operate/assign.md",
    frontMatter: {
      title: "Assign an incident",
      evidence: { E01: record("sys_ux_list", LIST, "read the list", { hash: "l1" }) },
    },
    body: "## Who gets the incident {label=NEW}\n\nOpen the Unassigned list. [E01]\n\n{{animation:asg}}\n",
  },
  resolve: {
    path: "processes/incident/operate/resolve.md",
    frontMatter: {
      title: "Resolve an incident",
      evidence: { E01: record("sys_ui_action", ACTION, "read Resolve", { hash: "a1" }) },
    },
    body: "Choose Resolve. [E01]",
  },
  configureAssign: {
    path: "processes/incident/configure/assign.md",
    frontMatter: {
      title: "Assignment configuration",
      evidence: {
        E01: record("sys_script", RULE, "read it", { field: "script", hash: sha256Hex(SCRIPT) }),
      },
    },
    body: "The rule sets the group. [E01]",
  },
  configureResolve: {
    path: "processes/incident/configure/resolve.md",
    frontMatter: {
      title: "Resolution configuration",
      evidence: { E01: record("sys_ui_action", ACTION, "read Resolve", { hash: "a1" }) },
    },
    body: "The action sets the state. [E01]",
  },
} satisfies Record<string, PageSource>;

export const ALL: readonly PageSource[] = Object.values(pages);

export const scene: SceneSource = {
  path: "animations/asg",
  animation: { name: "asg", title: "Assignment", heading: "How a group is chosen" },
  svg: '<svg viewBox="0 0 960 440"><g id="cam"></g></svg>',
  css: null,
  steps: [{ t: "Saved", c: "The incident is saved.", say: "The incident is saved." }],
};

export const NO_MEDIA: MediaTools = {
  codec: {
    available: async () => false,
    decode: async () => new Float32Array(0),
    encodeMp3: async () => new Uint8Array(0),
  },
  voices: [],
  assets: { bed: async () => null, sound: async () => null },
  video: { available: async () => false, render: async () => new Uint8Array(0) },
  videos: { write: async (name) => `/videos/${name}.mp4` },
};

export function fakeSources(
  list: readonly PageSource[],
  options: {
    scenes?: SceneSource[];
    site?: unknown;
    process?: unknown;
    others?: { path: string; process: unknown }[];
  } = {},
) {
  const pinned = new Map<string, Map<string, string>>();
  const sources: DocumentationSources = {
    site: async () => (options.site === undefined ? SITE : options.site),
    processes: async () => [
      { path: "processes/incident/process.yaml", process: options.process ?? PROCESS },
      ...(options.others ?? []),
    ],
    pages: async () => list,
    scenes: async () => options.scenes ?? [scene],
    pinHashes: async (path, hashes) => {
      pinned.set(path, new Map(hashes));
    },
  };
  return { sources, pinned };
}

const MIRROR: Record<string, MirrorRecord> = {
  [`sys_script/${RULE}`]: { hash: "aaa", fields: { script: SCRIPT, name: "Set group" } },
  [`sc_cat_item_producer/${PRODUCER}`]: { hash: "p1", fields: { name: "Report an issue" } },
  [`sys_ux_list/${LIST}`]: { hash: "l1", fields: { title: "Unassigned" } },
  [`sys_ui_action/${ACTION}`]: { hash: "a1", fields: { name: "Resolve" } },
};

export function fakeMirror(records: Record<string, MirrorRecord> = MIRROR): MirrorRecords {
  return {
    read: async (table, sysId) => records[`${table}/${sysId}`] ?? null,
    head: async () => "4db7753abcdef0123456789",
  };
}

export const run = {
  root: "/ws",
  signal: new AbortController().signal,
  clock: () => new Date("2026-10-17T10:00:00Z"),
  mirror: () => fakeMirror(),
};

// A page with one field replaced.
export function withPage(page: PageSource, change: Partial<PageSource>): PageSource {
  return { ...page, ...change };
}
