import { JsonLd, Seo, schema } from "@anubhav-choubey/web-for-agents";
import { FAQ } from "../data";

export function Faq() {
  return (
    <>
      <Seo title="FAQ" description="Answers about shipping, returns and used books at Paper Lantern Books." canonical="/faq" />
      <JsonLd data={schema.faqPage(FAQ)} />
      <h1>Frequently asked questions</h1>
      <dl>
        {FAQ.map((f) => (
          <div key={f.question}>
            <dt>{f.question}</dt>
            <dd>{f.answer}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
