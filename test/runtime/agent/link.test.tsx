import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { agentLinkProps } from "../../../src/index";
import { agentLinkProps as fromLinkEntry } from "../../../src/entries/link";
import { listAgentActions } from "../../../src/runtime/agent/registry";

describe("agentLinkProps", () => {
  it("returns the data-agent-* hints and registers nothing", () => {
    expect(agentLinkProps({ name: "open-resume", description: "Open the resume" })).toEqual({
      "data-agent-action": "open-resume",
      "data-agent-description": "Open the resume",
      "aria-description": "Open the resume",
      "data-agent-kind": "link",
    });
    expect(agentLinkProps({ name: "unsub", description: "Unsubscribe", destructive: true })).toMatchObject({
      "data-agent-destructive": "true",
    });
    expect(listAgentActions()).toEqual([]);
  });

  it("throws on an invalid name", () => {
    expect(() => agentLinkProps({ name: "has space", description: "x" })).toThrow(/invalid action name/);
  });

  it("renders on the server", () => {
    const html = renderToStaticMarkup(
      <a href="/cv.pdf" {...agentLinkProps({ name: "open-resume", description: "CV" })}>
        CV
      </a>,
    );
    expect(html).toBe('<a href="/cv.pdf" data-agent-action="open-resume" data-agent-description="CV" aria-description="CV" data-agent-kind="link">CV</a>');
  });

  it("is the same function from the /link entry", () => {
    expect(fromLinkEntry).toBe(agentLinkProps);
  });
});
