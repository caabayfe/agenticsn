export const parseToml = (text: string): unknown => Bun.TOML.parse(text);
