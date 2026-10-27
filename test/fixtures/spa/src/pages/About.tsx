import { useEffect, useState } from "react";
import { ExcludeFromContent, holdPrerender, JsonLd, schema, Seo } from "../../../../../src/index";

/** Minifies to `return/^[a-z]+:/i.test(...)`, which happy-dom 21 cannot load unless the prerender server wraps the regex. */
function hasScheme(href: string): boolean {
  return /^[a-z]+:/i.test(href);
}

export function About() {
  const [text, setText] = useState("");
  useEffect(() => {
    const release = holdPrerender();
    fetch(`${import.meta.env.BASE_URL}data.json`)
      .then((r) => r.json())
      .then((d: { text: string }) => setText(d.text))
      .finally(release);
  }, []);
  return (
    <>
      <Seo title="About" description="About us" />
      <JsonLd data={schema.organization({ name: "Fixture Org", url: "https://example.com" })} />
      <main>
        <h1>About us</h1>
        <p>{text}</p>
        <p>{hasScheme(location.href) ? "Runtime regex ran" : "Runtime regex missing"}</p>
        <p>
          See the <a href="/blog/hello">hello post</a>.
        </p>
        <ExcludeFromContent>Newsletter signup</ExcludeFromContent>
      </main>
      <footer>Footer text</footer>
    </>
  );
}
