import { JsonLd, Seo, schema } from "@anubhav-choubey/web-for-agents";
import { Link } from "react-router";
import { BOOKS, POSTS, SITE_URL } from "../data";

export function Home() {
  return (
    <>
      {/* No title: the provider's siteName and description apply. */}
      <Seo canonical="/" />
      <JsonLd
        data={[
          schema.webSite({
            name: "Paper Lantern Books",
            url: SITE_URL,
            searchUrlTemplate: `${SITE_URL}/books?q={search_term_string}`,
          }),
          schema.organization({
            name: "Paper Lantern Books",
            url: SITE_URL,
            logo: `${SITE_URL}/og.svg`,
            sameAs: ["https://social.example/paperlantern"],
          }),
        ]}
      />
      <h1>Paper Lantern Books</h1>
      <p>A small independent bookshop with hand-picked reads, shelved by mood rather than genre.</p>
      <h2>Explore the shop</h2>
      <ul>
        <li>
          <Link to="/books">All books</Link>
        </li>
        {BOOKS.map((b) => (
          <li key={b.slug}>
            <Link to={`/books/${b.slug}`}>{b.title}</Link>
          </li>
        ))}
        <li>
          <Link to="/new-arrivals">New arrivals</Link>
        </li>
        <li>
          <Link to="/blog">Blog</Link>
        </li>
        {POSTS.map((p) => (
          <li key={p.slug}>
            <Link to={`/blog/${p.slug}`}>{p.title}</Link>
          </li>
        ))}
        <li>
          <Link to="/faq">Frequently asked questions</Link>
        </li>
        <li>
          <Link to="/contact">Contact us</Link>
        </li>
        <li>
          <Link to="/account">Your account</Link>
        </li>
      </ul>
    </>
  );
}
