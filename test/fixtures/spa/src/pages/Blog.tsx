import { Seo } from "../../../../../src/index";
import { byline } from "./byline";

export default function Blog() {
  return (
    <>
      <Seo title="Blog" description="Posts" />
      <main>
        <h1>Blog</h1>
        <p>{byline("grace")}</p>
        <ul>
          <li>
            <a href="/blog/hello">Hello</a>
          </li>
        </ul>
      </main>
    </>
  );
}
