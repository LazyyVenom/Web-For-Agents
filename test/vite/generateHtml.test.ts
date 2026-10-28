import { describe, expect, it } from "vitest";
import { detectCharset, setMarkdownLink } from "../../src/vite/generateHtml";

const HREF = "https://me.dev/about.md";
const LINK = `<link rel="alternate" type="text/markdown" href="${HREF}" data-wfa="markdown">`;

/** Runs setMarkdownLink on UTF-8 text and returns the new text and what it did. */
function run(html: string, href = HREF) {
  const edit = setMarkdownLink(Buffer.from(html, "utf8"), "utf-8", href)!;
  return { html: edit.bytes.toString("utf8"), action: edit.action };
}

const count = (s: string) => s.split('type="text/markdown"').length - 1;

describe("setMarkdownLink", () => {
  it("skips a </head> inside a script body and leaves the script unchanged", () => {
    const script = '<script>var s="</head>"; if (a < b) { x = "<head>" }</script>';
    const html = `<!doctype html><html><head><title>t</title>${script}</head><body>x</body></html>`;
    const { html: out, action } = run(html);
    expect(action).toBe("inserted");
    expect(out).toBe(html.replace(`${script}</head>`, `${script}${LINK}</head>`));
    expect(out).toContain(script);
    expect(count(out)).toBe(1);
  });

  it("skips a </head> inside a comment, a style body, a title and an attribute value", () => {
    const head =
      '<!-- old </head> marker --><style>a::after{content:"</head>"}</style><title>a </head> b</title>' +
      '<meta name="x" content="</head>"><meta content=\'</head>\'>';
    const html = `<html><head>${head}</HEAD><body><p>x</p></body></html>`;
    const { html: out } = run(html);
    expect(out).toBe(`<html><head>${head}${LINK}</HEAD><body><p>x</p></body></html>`);
    expect(count(out)).toBe(1);
  });

  it("inserts before an uppercase </HEAD>", () => {
    const { html: out } = run("<HTML><HEAD><TITLE>t</TITLE></HEAD><BODY>x</BODY></HTML>");
    expect(out).toBe(`<HTML><HEAD><TITLE>t</TITLE>${LINK}</HEAD><BODY>x</BODY></HTML>`);
  });

  it("without </head>: after <head ...>, else before <body, else at the top", () => {
    expect(run('<html><head lang="en"><title>t</title><body>x').html).toBe(
      `<html><head lang="en">${LINK}<title>t</title><body>x`,
    );
    expect(run('<html><script>"<head>"</script><body class="a">x</body>').html).toBe(
      `<html><script>"<head>"</script>${LINK}<body class="a">x</body>`,
    );
    expect(run("<p>just text</p>").html).toBe(`${LINK}<p>just text</p>`);
    // Never before the doctype: after it, and after an <html> start tag when there is one.
    expect(run("<!DOCTYPE html>\n<p>x</p>").html).toBe(`<!DOCTYPE html>${LINK}\n<p>x</p>`);
    expect(run('<!doctype html><html lang="en"><p>x</p></html>').html).toBe(
      `<!doctype html><html lang="en">${LINK}<p>x</p></html>`,
    );
    expect(run("<html><p>x</p></html>").html).toBe(`<html>${LINK}<p>x</p></html>`);
  });

  it("leaves the page's own markdown link untouched and inserts nothing", () => {
    for (const own of [
      '<link rel="alternate" type="text/markdown" href="/mine.md">',
      "<link type='text/markdown; charset=utf-8' rel='alternate home' href=/mine.md>",
      '<link rel="alternate" type="text/markdown" href="/mine.md" data-wfa="something-else">',
    ]) {
      const html = `<head>${own}</head>`;
      expect(run(html)).toEqual({ html, action: "kept" });
    }
    // An own link next to an earlier marked one: still nothing is changed.
    const both = `<head>${LINK.replace(HREF, "/old.md")}<link rel="alternate" type="text/markdown" href="/mine.md"></head>`;
    expect(run(both)).toEqual({ html: both, action: "kept" });
  });

  it("updates only its own marked link, in place, and is idempotent", () => {
    const marked = `<head><link data-wfa="markdown" rel="alternate" type="text/markdown" href='/old.md' title="md"></head>`;
    const first = run(marked);
    expect(first.action).toBe("updated");
    expect(first.html).toBe(marked.replace("'/old.md'", `'${HREF}'`));
    const second = run(first.html);
    expect(second).toEqual({ html: first.html, action: "unchanged" });
    // An inserted link is found again on the next run.
    const inserted = run("<head></head>").html;
    expect(run(inserted)).toEqual({ html: inserted, action: "unchanged" });
    // Unquoted and bare hrefs on a marked link.
    expect(run("<head><link rel=alternate type=text/markdown data-wfa=markdown href=/x.md></head>").html).toBe(
      `<head><link rel=alternate type=text/markdown data-wfa=markdown href="${HREF}"></head>`,
    );
    expect(run("<head><link rel=alternate type=text/markdown data-wfa=markdown href></head>").html).toBe(`<head>${LINK}</head>`);
  });

  it("ignores markdown links in comments or scripts and other alternate links", () => {
    const head =
      '<!-- <link rel="alternate" type="text/markdown" href="/c.md"> -->' +
      '<script>document.write(\'<link rel="alternate" type="text/markdown" href="/s.md">\')</script>' +
      '<link rel="alternate" hreflang="de" href="/de/">';
    const { html: out, action } = run(`<head>${head}</head>`);
    expect(action).toBe("inserted");
    expect(out).toBe(`<head>${head}${LINK}</head>`);
  });

  it("keeps every other byte of a windows-1252 file and escapes non-ASCII in the href", () => {
    const bytes = Buffer.from('<head><meta charset="windows-1252"><title>Caf\xe9 \x80</title></head>', "latin1");
    expect(detectCharset(bytes)).toBe("windows-1252");
    const out = setMarkdownLink(bytes, "windows-1252", "https://me.dev/é.md")!.bytes;
    const at = bytes.indexOf("</head>");
    const link = Buffer.from('<link rel="alternate" type="text/markdown" href="https://me.dev/&#xe9;.md" data-wfa="markdown">', "latin1");
    expect(out.equals(Buffer.concat([bytes.subarray(0, at), link, bytes.subarray(at)]))).toBe(true);
  });

  it("returns null for UTF-16", () => {
    expect(setMarkdownLink(Buffer.from([0xff, 0xfe, 0x3c, 0x00]), "utf-16le", HREF)).toBeNull();
  });
});
