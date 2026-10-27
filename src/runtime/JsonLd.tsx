import { serializeJsonLd, type JsonLdNode } from "./jsonld";

export function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
