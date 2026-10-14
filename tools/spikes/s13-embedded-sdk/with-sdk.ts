// Spike S13, test A5: snagentic with the SDK's build behind a lazy import, as product code would
// hold it. Only `fluent-build <project>` loads the SDK; every other command starts as today.
if (process.argv[2] === "fluent-build") {
  process.argv.splice(2, 1);
  await import("./embed");
} else {
  await import("../../../packages/cli/src/main");
}
