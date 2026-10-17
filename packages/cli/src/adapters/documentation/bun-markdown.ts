import type { MarkdownRenderer } from "@snagentic/core";

// Bun's built-in CommonMark and GFM renderer; raw HTML passes through, which the page model
// uses for labels, citations and animations.
export const bunMarkdown: MarkdownRenderer = {
  html: (markdown) => Bun.markdown.html(markdown),
};
