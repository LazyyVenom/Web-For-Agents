import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { markupActions } from "../../src/shared/markupActions";

describe("markupActions", () => {
  it("finds data-agent-action elements, then WebMCP forms, with trimmed names and no dedupe", () => {
    const window = new Window();
    const doc = window.document as unknown as Document;
    doc.body.innerHTML = `
      <form toolname="search" tooldescription="Search posts"></form>
      <button data-agent-action=" buy " data-agent-description="Buy it" data-agent-destructive="true"></button>
      <form data-agent-action="contact" data-agent-description=""></form>
      <div data-agent-action="  "></div>
      <form toolname="contact"></form>`;
    const list = markupActions(doc).map(({ element, ...rest }) => ({ tag: element.tagName, ...rest }));
    expect(list).toEqual([
      { tag: "BUTTON", name: "buy", description: "Buy it", kind: "click", destructive: true, source: "markup" },
      { tag: "FORM", name: "contact", description: null, kind: "form", destructive: false, source: "markup" },
      { tag: "FORM", name: "search", description: "Search posts", kind: "form", destructive: false, source: "webmcp-declarative" },
      { tag: "FORM", name: "contact", description: null, kind: "form", destructive: false, source: "webmcp-declarative" },
    ]);
    window.happyDOM.close();
  });
});
