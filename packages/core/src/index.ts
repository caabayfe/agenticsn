// Public API of @snagentic/core. Other packages import only from here.
export { canonicalJson, type JsonValue } from "./kernel/canonical-json";
export { canonicalText } from "./kernel/canonical-text";
export {
  ERROR_CATEGORIES,
  type ErrorCategory,
  EXIT_CODES,
  exitCodeFor,
  type InvalidIdentifierCode,
  InvalidIdentifierError,
  SnagenticError,
  UNEXPECTED_ERROR_EXIT_CODE,
} from "./kernel/errors";
export { HASH_EXCLUDED_FIELDS, recordHash } from "./kernel/record-hash";
export { ScopeName } from "./kernel/scope-name";
export { slug } from "./kernel/slug";
export { SysId } from "./kernel/sys-id";
export { TableName } from "./kernel/table-name";
export { VERSION } from "./version";
