import { Seo } from "../../../../../src/index";

export function Blog() {
  return (
    <>
      <Seo title="Blog" description="Posts" />
      <main>
        <h1>Blog</h1>
        <ul>
          <li>
            <a href="/blog/hello">Hello</a>
          </li>
        </ul>
      </main>
    </>
  );
}
