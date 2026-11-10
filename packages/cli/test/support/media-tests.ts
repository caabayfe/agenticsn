type Environment = Readonly<Record<string, string | undefined>>;

// The tests that drive a real ffmpeg, Chrome or Piper are slow and depend on the machine, so CI
// runs them in their own job (spec 014, R1). SNAGENTIC_TEST_MEDIA chooses:
//   unset    run them where the program is installed (a plain `bun test`, as before);
//   skip     never run them (the gating CI legs);
//   require  run them, and fail when the program is missing (the media CI job), so a job
//            without the tools cannot pass by skipping everything.
export function mediaTestsRun(
  program: string,
  installed: boolean,
  env: Environment = process.env,
): boolean {
  const mode = env["SNAGENTIC_TEST_MEDIA"];
  if (mode === undefined || mode === "") return installed;
  if (mode === "skip") return false;
  if (mode === "require") {
    if (!installed) throw new Error(`${program} is required: SNAGENTIC_TEST_MEDIA=require`);
    return true;
  }
  throw new Error(`SNAGENTIC_TEST_MEDIA must be skip or require, not ${mode}`);
}
