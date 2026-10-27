import { Seo } from "@anubhav-choubey/web-for-agents";
import { Link } from "react-router";
import { POSTS } from "../data";

export default function Blog() {
  return (
    <>
      <Seo title="Blog" description="Notes from the booksellers at Paper Lantern Books on shelving, reading and small presses." canonical="/blog" />
      <h1>Blog</h1>
      <ul>
        {POSTS.map((p) => (
          <li key={p.slug}>
            <Link to={`/blog/${p.slug}`}>{p.title}</Link> ({p.date}): {p.summary}
          </li>
        ))}
      </ul>
    </>
  );
}
