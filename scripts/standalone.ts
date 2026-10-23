// Compile options that keep the binary from reading configuration from the directory it runs
// in. By default a compiled Bun program loads bunfig.toml (whose preload runs any script),
// .env, tsconfig.json and package.json from there; a workspace is not trusted input, and code
// it planted would run inside the binary the keychain trusts (spec 012, B-02).
export const STANDALONE = {
  autoloadBunfig: false,
  autoloadDotenv: false,
  autoloadTsconfig: false,
  autoloadPackageJson: false,
} as const;
