import type { Intent } from "./intent-types";
import { DATA_INTENTS } from "./intents-data";
import { PROCESS_INTENTS } from "./intents-process";

// What the user wants done, recognised from their words, and the ways to do it on the
// platform, least custom first (SN-ADV-DES-001). Deterministic: no model is involved.

export const INTENTS: readonly Intent[] = [...DATA_INTENTS, ...PROCESS_INTENTS];

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9 '-]+/g, " ")} `;

// Intents whose stems appear in the request, the most strongly matched first.
export function recognise(request: string): Intent[] {
  const text = words(request);
  return INTENTS.map((intent) => ({
    intent,
    hits: intent.stems.filter((stem) => text.includes(` ${stem}`)).length,
  }))
    .filter((match) => match.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((match) => match.intent);
}

export type { Customization, Intent, Option } from "./intent-types";
