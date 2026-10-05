import type { Brand } from "./brand";
import { InvalidIdentifierError } from "./errors";

export type SysId = Brand<string, "SysId">;

// 32 hex characters for modern records; out-of-box records created before that convention
// keep legacy ids such as "sysverb_query", "inbox", "2" or "Default view" (v1 rule).
const SYS_ID_PATTERN = /^[A-Za-z0-9_](?:[A-Za-z0-9_ ]{0,62}[A-Za-z0-9_])?$/;

export const SysId = {
  is(value: string): value is SysId {
    return SYS_ID_PATTERN.test(value);
  },
  parse(value: string): SysId {
    if (SysId.is(value)) {
      return value;
    }
    throw new InvalidIdentifierError("invalid-sys-id", value);
  },
};
