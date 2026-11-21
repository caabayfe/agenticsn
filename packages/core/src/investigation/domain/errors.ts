import { SnagenticError } from "../../kernel/errors";

export class MaskedFieldError extends SnagenticError {
  constructor(field: string) {
    super(
      "masked-field",
      "not-permitted",
      `the values of ${field} are masked in live results`,
      "a field whose values are masked cannot be used to select, sort or group; use a field whose values are shown",
    );
  }
}
