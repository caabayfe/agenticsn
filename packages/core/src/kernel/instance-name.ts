import type { Brand } from "./brand";
import { InvalidIdentifierError } from "./errors";

export type InstanceName = Brand<string, "InstanceName">;

// Used as a folder name and in git branch names, so it is deliberately narrow:
// lowercase words joined by single hyphens, at most 40 characters.
const INSTANCE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_LENGTH = 40;

export const InstanceName = {
  is(value: string): value is InstanceName {
    return value.length <= MAX_LENGTH && INSTANCE_NAME_PATTERN.test(value);
  },
  parse(value: string): InstanceName {
    if (InstanceName.is(value)) {
      return value;
    }
    throw new InvalidIdentifierError("invalid-instance-name", value);
  },
};
