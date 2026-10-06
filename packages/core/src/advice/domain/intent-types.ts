// The shape of an intent and its options (intents.ts recognises them).

export type Customization = "configuration" | "low-code" | "script";

export interface Option {
  readonly option: string;
  readonly customization: Customization;
  // The record classes this option creates or changes.
  readonly classes: readonly string[];
  readonly when: string;
  // The behavior phase on the target table that shows what already exists for this option.
  readonly evidence?:
    | "notify"
    | "client"
    | "policy"
    | "before"
    | "after"
    | "async"
    | "access"
    | "action";
}

export interface Intent {
  readonly id: string;
  readonly label: string;
  // Lower-case word stems; a match at the start of any word of the request counts.
  readonly stems: readonly string[];
  readonly options: readonly Option[];
}
