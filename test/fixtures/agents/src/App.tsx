import { useEffect, type ComponentType } from "react";
import { AgentForm, Seo, agentParam, useAgentAction } from "../../../../src/index";

/** Mounted twice on "/": the duplicate name keeps only the first mounted one. */
function SubscribeButton({ where }: { where: string }) {
  const { ref, hintProps } = useAgentAction({
    name: "subscribe",
    description: `Subscribe to the newsletter (${where})`,
    handler: async () => ({ subscribed: true }),
  });
  return (
    <button type="button" ref={ref} {...hintProps}>
      Subscribe
    </button>
  );
}

function Home() {
  return (
    <>
      <Seo title="Home" description="Agents fixture home" />
      <header>
        <SubscribeButton where="header" />
      </header>
      <main>
        <h1>Home</h1>
        <a href="/contact">Contact</a> <a href="/account">Account</a>
        <AgentForm agent={{ name: "search", description: "Search the site" }} action="/search">
          <input name="q" {...agentParam("Search terms")} />
        </AgentForm>
      </main>
      <footer>
        <SubscribeButton where="footer" />
      </footer>
    </>
  );
}

function Contact() {
  return (
    <main>
      <Seo title="Contact" description="Get in touch" />
      <h1>Contact</h1>
      <AgentForm agent={{ name: "contact", description: "Send us a message" }} action="/thanks">
        <input type="email" name="email" required {...agentParam("Your email address")} />
        <select name="topic">
          <option value="sales">Sales</option>
          <option value="support">Support</option>
        </select>
        <input type="hidden" name="token" value="t0k3n" />
        <input type="password" name="secret" />
        <input type="file" name="attachment" />
        <button type="submit">Send</button>
      </AgentForm>
    </main>
  );
}

function Account() {
  const { ref, hintProps } = useAgentAction({
    name: "delete_account",
    description: "Delete the account",
    destructive: true,
    handler: async () => ({ deleted: true }),
  });
  return (
    <main>
      <Seo title="Account" description="Your account" />
      <h1>Account</h1>
      <button type="button" ref={ref} {...hintProps}>
        Delete account
      </button>
    </main>
  );
}

/** Only prerendered when listed in `routes`: makes the agent-map in-page script throw. */
function Broken() {
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__WEB_FOR_AGENTS__ = {
      actions() {
        throw new Error("agent map boom");
      },
    };
  }, []);
  return (
    <main>
      <Seo title="Broken" />
      <h1>Broken</h1>
    </main>
  );
}

const PAGES: Record<string, ComponentType> = { "/": Home, "/contact": Contact, "/account": Account, "/broken": Broken };

export function App() {
  const Page = PAGES[window.location.pathname.replace(/(.)\/+$/, "$1")];
  return Page ? <Page /> : <main><h1>Not found</h1></main>;
}
