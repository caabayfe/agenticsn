// What the SDK's conversion writes that its own types reject (spec 009 X4): fixed in the
// converted source before it is built, or refused with what to do on the instance. Tied to the
// SDK version snagentic embeds, like the known losses; the recorded fixtures prove each entry.

export const CONVERSION_FIXES_SDK_VERSION = "4.13.6";

interface Fix {
  readonly id: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

interface Refusal {
  readonly pattern: RegExp;
  readonly reason: string;
}

const EMPTY = (property: string) => new RegExp(`\\b${property}:(\\s*)(['"])\\2`, "g");

const FIXES: readonly Fix[] = [
  // An empty type converts to '' instead of the API's default; the platform shows no message
  // either way, and every action on pdi2 has an empty message. The load then writes none.
  {
    id: "ui-policy-empty-message-type",
    pattern: EMPTY("fieldMessageType"),
    replacement: "fieldMessageType:$1'none'",
  },
];

const REFUSALS: readonly Refusal[] = [
  // The SDK would write package_private or public, and either changes who may call the code.
  {
    pattern: EMPTY("accessibleFrom"),
    reason:
      "the script include's access is empty, which the SDK can't express: set Accessible from on the instance (this application scope only, or all application scopes), then adopt again",
  },
];

export interface ConversionOutcome {
  readonly text: string;
  readonly fixed: readonly string[];
  readonly refused: readonly string[];
}

// One converted file: its fixed text, the fixes applied, and why it can't be adopted.
export function fixConverted(file: string, text: string): ConversionOutcome {
  let fixedText = text;
  const fixed: string[] = [];
  for (const fix of FIXES) {
    const next = fixedText.replace(fix.pattern, fix.replacement);
    if (next !== fixedText) fixed.push(fix.id);
    fixedText = next;
  }
  const refused = REFUSALS.filter((refusal) => new RegExp(refusal.pattern).test(fixedText)).map(
    (refusal) => `${file}: ${refusal.reason}`,
  );
  return { text: fixedText, fixed, refused };
}
