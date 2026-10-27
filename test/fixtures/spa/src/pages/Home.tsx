import { Link } from "react-router";
import { Seo } from "../../../../../src/index";

export function Home() {
  return (
    <>
      <Seo title="Home" description="Welcome" />
      <nav>
        <Link to="/about">Nav about</Link>
        <Link to="/blog/">Nav blog</Link>
        <Link to="/blog/hello?ref=nav#top">Nav hello</Link>
        <Link to="/draft">Nav draft</Link>
        <Link to="/admin/secret">Nav admin</Link>
        <a href="https://external.example/x">Nav external</a>
        <a href="mailto:a@b.c">Nav mail</a>
        <a href={`${import.meta.env.BASE_URL}logo.png`}>Nav logo</a>
      </nav>
      <main>
        <h1>Welcome home</h1>
        <p>Home page body.</p>
      </main>
    </>
  );
}
