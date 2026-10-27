import { useState, type FormEvent } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { agentParam, useAgentAction } from "@anubhav-choubey/web-for-agents";
import { BOOKS } from "./data";

/** A search form that is also an agent action with a handler and its own input schema. */
function SearchForm() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { ref, hintProps } = useAgentAction<{ query: string }, { count: number; titles: string[] }>({
    name: "search",
    description: "Search the shop's books by title or author",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    },
    readOnly: true,
    handler: ({ query: q }) => {
      const needle = q.toLowerCase();
      const hits = BOOKS.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(needle));
      navigate(`/books?q=${encodeURIComponent(q)}`);
      return { count: hits.length, titles: hits.map((b) => b.title) };
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/books?q=${encodeURIComponent(query)}`);
  };
  return (
    <form ref={ref} {...hintProps} role="search" className="search" onSubmit={submit}>
      <input
        type="search"
        name="query"
        aria-label="Search books"
        placeholder="Search books"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        {...agentParam("Words to look for in a title or author")}
      />
      <button type="submit">Search</button>
    </form>
  );
}

export function Layout() {
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand">
          Paper Lantern Books
        </Link>
        <nav aria-label="Main">
          <Link to="/books">Books</Link>
          <Link to="/new-arrivals">New arrivals</Link>
          <Link to="/blog">Blog</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/account">Account</Link>
        </nav>
        <SearchForm />
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">Paper Lantern Books is a made-up shop used to demo web-for-agents.</footer>
    </>
  );
}
