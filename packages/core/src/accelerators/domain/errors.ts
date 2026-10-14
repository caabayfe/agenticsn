import { SnagenticError } from "../../kernel/errors";

export class PackNotFoundError extends SnagenticError {
  constructor(pack: string, known: readonly string[]) {
    super(
      "pack-not-found",
      "usage",
      `no accelerator pack ${pack}`,
      known.length === 0
        ? "this snagentic ships no accelerator packs"
        : `run snagentic accelerator list; known packs: ${known.join(", ")}`,
    );
  }
}

export class InvalidPackError extends SnagenticError {
  constructor(pack: string, problems: readonly string[]) {
    super(
      "invalid-pack",
      "precondition",
      `accelerator pack ${pack} is not valid: ${problems.join("; ")}`,
      "the pack ships with snagentic: report it, with this message",
    );
  }
}
