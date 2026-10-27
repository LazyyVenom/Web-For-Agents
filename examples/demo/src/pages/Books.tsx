import { Seo, useAgentAction } from "@anubhav-choubey/web-for-agents";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { BOOKS } from "../data";

/** A destructive click action: the user is asked to confirm before it runs. */
function ClearCart() {
  const [items, setItems] = useState(2);
  const { ref, hintProps } = useAgentAction({
    name: "clear-cart",
    description: "Remove every item from the shopping cart",
    destructive: true,
    handler: () => {
      setItems(0);
      return { cleared: true };
    },
  });
  return (
    <section className="cart" aria-label="Cart">
      <p>Items in cart: {items}</p>
      <button type="button" ref={ref} {...hintProps} onClick={() => setItems(0)}>
        Clear cart
      </button>
    </section>
  );
}

export function Books() {
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").toLowerCase();
  const shown = BOOKS.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(q));
  return (
    <>
      <Seo title="Books" description="Every book on the shelves at Paper Lantern Books, with prices and authors." canonical="/books" />
      <h1>Books</h1>
      <ul className="cards">
        {shown.map((b) => (
          <li key={b.slug}>
            <Link to={`/books/${b.slug}`}>{b.title}</Link> by {b.author}, ${b.price.toFixed(2)}
          </li>
        ))}
      </ul>
      <ClearCart />
    </>
  );
}
