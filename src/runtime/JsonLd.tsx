import { serializeJsonLd, type JsonLdGraph, type JsonLdNode } from "./schema";

/** Renders a `<script type="application/ld+json">` with `data`, escaped for safe embedding in HTML. */
export function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] | JsonLdGraph }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
