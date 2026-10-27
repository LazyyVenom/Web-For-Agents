import { Link, Route, Routes } from "react-router";
import { AgentForm, JsonLd, Seo, schema } from "@anubhav-choubey/web-for-agents";

function Home() {
  return (
    <main>
      <Seo
        title="Loose-leaf teas from small gardens"
        description="Lantern Tea sells loose-leaf green, black and oolong teas sourced directly from small family gardens, packed fresh every week."
      />
      <JsonLd data={schema.organization({ name: "Lantern Tea", url: "https://lantern-tea.example" })} />
      <h1>Lantern Tea</h1>
      <p>
        We buy loose-leaf tea directly from small family gardens in Darjeeling, Assam, Fujian and Shizuoka. Every
        tea is tasted before it is listed, packed in small batches each week and shipped in resealable tins so it
        stays fresh. Read about the people who grow it, or learn how we brew each tea in our shop.
      </p>
      <nav>
        <Link to="/about">About us</Link> <Link to="/contact">Contact</Link>
      </nav>
    </main>
  );
}

function About() {
  return (
    <main>
      <Seo
        title="About the Lantern Tea shop"
        description="Lantern Tea started as a market stall in 2019 and now works with twelve family tea gardens across four countries."
      />
      <JsonLd data={schema.organization({ name: "Lantern Tea", url: "https://lantern-tea.example" })} />
      <h1>About us</h1>
      <p>
        Lantern Tea started as a weekend market stall in 2019. Today we work with twelve family gardens across four
        countries and pay them well above the auction price. Our shop is small on purpose: we would rather sell a
        few teas we love than a long list we cannot vouch for. <Link to="/">Back home</Link>
      </p>
    </main>
  );
}

function Contact() {
  return (
    <main>
      <Seo title="Contact Lantern Tea" description="Send Lantern Tea a question about an order, a tea or wholesale, and we reply within two working days." />
      <h1>Contact</h1>
      <p>Questions about an order, a tea or wholesale? Send us a message and we reply within two working days.</p>
      <AgentForm agent={{ name: "contact", description: "Send a message to the shop" }} onSubmit={(e) => e.preventDefault()}>
        <label>
          Email <input name="email" type="email" required />
        </label>
        <label>
          Message <textarea name="message" required />
        </label>
        <button type="submit">Send</button>
      </AgentForm>
      <Link to="/">Back home</Link>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/contact" element={<Contact />} />
    </Routes>
  );
}
