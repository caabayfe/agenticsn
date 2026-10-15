// Spike S13, test A5/A6: the SDK's build as a second entry point in the binary, imported by a
// computed path so the bundler does not fold it into the main program.
if (process.argv[2] === "fluent-build") {
  process.argv.splice(2, 1);
  await import(["./embed", "js"].join("."));
} else {
  await import("../../../packages/cli/src/main");
}
