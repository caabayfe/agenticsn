import type { ToolCall, Trace } from "./types";

interface Block {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly text?: string;
  readonly tool_use_id?: string;
  readonly content?: unknown;
  readonly is_error?: boolean;
}

interface StreamEvent {
  readonly type?: string;
  readonly subtype?: string;
  readonly model?: string;
  readonly skills?: readonly string[];
  readonly message?: { readonly content?: readonly Block[] | string };
  readonly result?: string;
  readonly total_cost_usd?: number;
  readonly duration_ms?: number;
  readonly is_error?: boolean;
}

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part: { text?: unknown }) => (typeof part.text === "string" ? part.text : ""))
      .join("\n");
  }
  return "";
}

const blocks = (event: StreamEvent): readonly Block[] =>
  Array.isArray(event.message?.content) ? event.message.content : [];

interface Accumulator {
  readonly calls: ToolCall[];
  readonly pending: Map<string, { name: string; input: Record<string, unknown>; turn: number }>;
  skillsAvailable: readonly string[];
  costUsd: number;
  seconds: number;
  model: string;
  error: string | null;
  reply: string;
}

function onBlock(acc: Accumulator, event: StreamEvent, block: Block, turn: number): void {
  if (event.type === "assistant" && block.type === "tool_use" && block.id !== undefined) {
    acc.pending.set(block.id, { name: block.name ?? "", input: block.input ?? {}, turn });
  } else if (event.type === "assistant" && block.type === "text") {
    acc.reply = block.text ?? acc.reply;
  } else if (block.type === "tool_result" && block.tool_use_id !== undefined) {
    const call = acc.pending.get(block.tool_use_id);
    acc.pending.delete(block.tool_use_id);
    if (call !== undefined) {
      acc.calls.push({ ...call, result: textOf(block.content), isError: block.is_error === true });
    }
  }
}

function onEvent(acc: Accumulator, event: StreamEvent, turn: number): void {
  if (event.type === "system" && event.subtype === "init") {
    acc.skillsAvailable = event.skills ?? acc.skillsAvailable;
    acc.model = event.model ?? acc.model;
  }
  for (const block of blocks(event)) {
    onBlock(acc, event, block, turn);
  }
  if (event.type === "result") {
    acc.costUsd += event.total_cost_usd ?? 0;
    acc.seconds += (event.duration_ms ?? 0) / 1000;
    acc.reply = event.result ?? acc.reply;
    acc.error = event.is_error === true ? (event.subtype ?? "error") : acc.error;
  }
}

// Builds a trace from Claude Code's stream-json output, one stream per user turn.
export function parseClaudeStreams(streams: readonly string[]): Trace {
  const acc: Accumulator = {
    calls: [],
    pending: new Map(),
    skillsAvailable: [],
    costUsd: 0,
    seconds: 0,
    model: "",
    error: null,
    reply: "",
  };
  const replies: string[] = [];
  streams.forEach((stream, turn) => {
    acc.reply = "";
    for (const line of stream.split("\n").filter((text) => text.startsWith("{"))) {
      onEvent(acc, JSON.parse(line), turn);
    }
    replies.push(acc.reply);
  });
  // Calls the host never answered (the run was cut short) still count as made.
  for (const call of acc.pending.values()) {
    acc.calls.push({ ...call, result: "", isError: true });
  }
  const { calls, skillsAvailable, costUsd, seconds, model, error } = acc;
  return { calls, replies, skillsAvailable, costUsd, seconds, model, error };
}
