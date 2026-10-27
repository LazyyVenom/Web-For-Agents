import { AgentForm, Seo, agentParam } from "@anubhav-choubey/web-for-agents";
import { useState, type FormEvent } from "react";

export function Contact() {
  const [sent, setSent] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSent(true);
  };
  return (
    <>
      <Seo title="Contact" description="Write to the Paper Lantern Books team with a question about an order or a book." canonical="/contact" />
      <h1>Contact</h1>
      {/* No handler: the schema comes from the fields and an agent fills in and submits this form. */}
      <AgentForm agent={{ name: "contact", description: "Send a message to the Paper Lantern Books team" }} onSubmit={submit}>
        <label>
          Name
          <input type="text" name="name" required {...agentParam("Your name")} />
        </label>
        <label>
          Email
          <input type="email" name="email" required {...agentParam("Your email address")} />
        </label>
        <label>
          Message
          <textarea name="message" required minLength={10} maxLength={1000} rows={5} {...agentParam("What you would like to ask")} />
        </label>
        {/* Never exposed to agents: a hidden CSRF field and a readonly field. */}
        <input type="hidden" name="csrf" value="demo-csrf-token-9f2c" />
        <input type="text" name="reference" value="web-contact" readOnly aria-label="Reference" />
        <button type="submit">Send message</button>
        <div role="status">{sent ? "Thanks, your message was sent." : ""}</div>
      </AgentForm>
    </>
  );
}
