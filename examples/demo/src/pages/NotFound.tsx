import { Seo } from "@anubhav-choubey/web-for-agents";

export function NotFound() {
  return (
    <>
      <Seo title="Not found" noindex />
      <h1>Page not found</h1>
      <p>That page is not on our shelves.</p>
    </>
  );
}
