import { JsonLd, Seo, schema } from "@anubhav-choubey/web-for-agents";
import { Link, useParams } from "react-router";
import { BOOKS, SITE_URL } from "../data";
import { NotFound } from "./NotFound";

export function Book() {
  const { slug } = useParams();
  const book = BOOKS.find((b) => b.slug === slug);
  if (!book) return <NotFound />;
  const url = `${SITE_URL}/books/${book.slug}`;
  return (
    <>
      <Seo title={book.title} description={`${book.blurb} By ${book.author}.`} canonical={`/books/${book.slug}`} type="product" />
      <JsonLd
        data={[
          schema.product({
            name: book.title,
            description: book.blurb,
            sku: book.sku,
            brand: "Paper Lantern Books",
            image: `${SITE_URL}/og.svg`,
            offers: { price: book.price.toFixed(2), priceCurrency: "USD", availability: "InStock", url },
          }),
          schema.breadcrumbList([
            { name: "Home", url: SITE_URL + "/" },
            { name: "Books", url: SITE_URL + "/books" },
            { name: book.title, url },
          ]),
        ]}
      />
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/">Home</Link> / <Link to="/books">Books</Link> / {book.title}
      </nav>
      <h1>{book.title}</h1>
      <p>By {book.author}</p>
      <p>{book.blurb}</p>
      <p>
        Price: ${book.price.toFixed(2)} (SKU {book.sku})
      </p>
    </>
  );
}
