import { Seo, JsonLd, schema } from "../../../../src/index";

export function App() {
  return (
    <>
      <Seo title="Home" description="Basic fixture" />
      <JsonLd data={schema.article({ headline: "Hello" })} />
      <h1>Hello</h1>
    </>
  );
}
