import { SnagenticError } from "../../kernel/errors";

export class MediaToolMissingError extends SnagenticError {
  constructor(tool: string, hint: string) {
    super("media-tool-missing", "precondition", `${tool} is not available on this machine`, hint);
  }
}

export class UnknownVoiceError extends SnagenticError {
  constructor(voice: string, known: readonly string[]) {
    super(
      "unknown-voice",
      "usage",
      `there is no voice called ${voice}`,
      `use one of: ${["none", ...known].join(", ")}`,
    );
  }
}
