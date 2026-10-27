import { Seo } from "@anubhav-choubey/web-for-agents";

export function Account() {
  return (
    <>
      {/* noindex: prerendered, but left out of sitemap.xml, llms.txt and agents.json. */}
      <Seo title="Your account" description="Your orders and details at Paper Lantern Books." canonical="/account" noindex />
      <h1>Your account</h1>
      <p>Sign in to see your orders. This page is private and is not indexed.</p>
    </>
  );
}
