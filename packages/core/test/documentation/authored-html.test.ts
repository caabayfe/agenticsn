import { describe, expect, it } from "bun:test";
import { safeLinks, withoutAuthorHtml } from "../../src/documentation/domain/authored-html";

describe("HTML a page's author wrote (spec 012, B-08)", () => {
  it("shows tags written in prose as text", () => {
    expect(withoutAuthorHtml("Open <number> then <img src=x onerror=alert(1)>")).toBe(
      "Open &lt;number> then &lt;img src=x onerror=alert(1)>",
    );
  });

  it("keeps code as written, and autolinks", () => {
    const markdown =
      "Use `<b>` here.\n\n```html\n<script>x</script>\n```\n\nSee <https://example.com>.";
    expect(withoutAuthorHtml(markdown)).toBe(markdown);
  });
});

describe("links in rendered pages (spec 012, B-08)", () => {
  it("keeps web, mail, anchor and relative links", () => {
    const html =
      '<a href="https://x.example/a?b=1&amp;c=2">a</a><a href="mailto:a@b.example">m</a>' +
      '<a href="#E01">c</a><a href="../use/x.html">r</a><img src="media/a.png" alt="">';
    expect(safeLinks(html)).toBe(html);
  });

  it("drops a link or image address with any other scheme, however it is written", () => {
    const html = [
      '<a href="javascript:alert(1)">a</a>',
      '<a href="JaVaScRiPt:x">b</a>',
      '<a href=" java\tscript:x">c</a>',
      '<a href="&#106;avascript:x">d</a>',
      '<a href="data:text/html,x">e</a>',
      '<img src="vbscript:x" alt="i">',
    ].join("");
    expect(safeLinks(html)).toBe('<a>a</a><a>b</a><a>c</a><a>d</a><a>e</a><img alt="i">');
  });
});
