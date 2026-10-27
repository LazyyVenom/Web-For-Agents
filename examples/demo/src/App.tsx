import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Layout } from "./Layout";
import { Account } from "./pages/Account";
import { Book } from "./pages/Book";
import { Books } from "./pages/Books";
import { Contact } from "./pages/Contact";
import { Faq } from "./pages/Faq";
import { Home } from "./pages/Home";
import { NewArrivals } from "./pages/NewArrivals";
import { NotFound } from "./pages/NotFound";

// The blog is code-split: its chunk loads on demand, and the prerenderer waits for it.
const Blog = lazy(() => import("./pages/Blog"));
const Post = lazy(() => import("./pages/Post"));

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/books" element={<Books />} />
        <Route path="/books/:slug" element={<Book />} />
        <Route
          path="/blog"
          element={
            <Suspense fallback={<p>Loading</p>}>
              <Blog />
            </Suspense>
          }
        />
        <Route
          path="/blog/:slug"
          element={
            <Suspense fallback={<p>Loading</p>}>
              <Post />
            </Suspense>
          }
        />
        <Route path="/faq" element={<Faq />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/new-arrivals" element={<NewArrivals />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
