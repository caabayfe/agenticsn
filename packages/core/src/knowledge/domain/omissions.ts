// What the mirror leaves out on purpose (ADR-0034 #3), said where it matters so an agent doesn't
// read an absence as a fact: an empty script, an inbound action that looks ready, a flow whose
// connection is nowhere to be found. A new omission is one entry here and a test.

// Turns email receiving on or off for the whole instance.
export const EMAIL_RECEIVING_SWITCH = "glide.email.read.active";

const INBOUND_EMAIL_CLASSES = new Set(["sysevent_in_email_action"]);
// Flows and actions, and the inputs through which they take a connection alias.
export const ALIAS_MODEL_CLASSES = new Set(["sys_hub_flow", "sys_hub_action_type_definition"]);
export const ALIAS_INPUT_CLASSES = new Set(["sys_hub_flow_input", "sys_hub_action_input"]);
const ALIAS_TABLE = "sys_alias";

const PROTECTED =
  "its code is protected by the platform and not readable: an empty or missing script here doesn't mean it has none";
const MAIL_ACCOUNTS =
  "mail accounts (sys_email_account) are not mirrored: they hold credentials, so whether this instance reads email from an account can't be told from the mirror";
const ALIASES =
  "connection aliases and connections (sys_alias, sys_connection) are not mirrored: they hold endpoints and credentials, so where this connects can't be told from the mirror";

export interface RecordOmissionFacts {
  readonly className: string;
  readonly fields: Readonly<Record<string, string>>;
  // A flow or action with an input that takes a connection alias.
  readonly mapsConnectionAlias: boolean;
  // The email receiving switch's value; null when the mirror doesn't hold it.
  readonly emailReceiving: string | null;
}

export function isProtected(fields: Readonly<Record<string, string>>): boolean {
  return fields["sys_policy"] === "protected";
}

export function takesConnectionAlias(
  className: string,
  fields: Readonly<Record<string, string>>,
): boolean {
  return ALIAS_INPUT_CLASSES.has(className) && fields["reference"] === ALIAS_TABLE;
}

export function recordOmissions(facts: RecordOmissionFacts): string[] {
  const { className, fields } = facts;
  const notes: string[] = [];
  if (isProtected(fields)) {
    notes.push(PROTECTED);
  }
  if (INBOUND_EMAIL_CLASSES.has(className)) {
    const state =
      facts.emailReceiving === null
        ? `${EMAIL_RECEIVING_SWITCH} is not in the mirror`
        : `${EMAIL_RECEIVING_SWITCH} is ${facts.emailReceiving}`;
    notes.push(MAIL_ACCOUNTS, `email receiving: ${state}`);
  }
  if (facts.mapsConnectionAlias || takesConnectionAlias(className, fields)) {
    notes.push(ALIASES);
  }
  return notes;
}

// For a table: how many of its behavior items have protected code.
export function tableOmissions(protectedItems: number): string[] {
  if (protectedItems === 0) {
    return [];
  }
  const what =
    protectedItems === 1
      ? "1 business rule or script on this table is protected"
      : `${protectedItems} business rules or scripts on this table are protected`;
  return [`${what}: its code is not readable, only its conditions and settings`];
}
