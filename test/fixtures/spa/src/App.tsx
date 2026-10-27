import { lazy, Suspense, useEffect } from "react";
import { Route, Routes } from "react-router";
import { About } from "./pages/About";
import { Boom } from "./pages/Boom";
import { Draft } from "./pages/Draft";
import { Hidden } from "./pages/Hidden";
import { Home } from "./pages/Home";

const Blog = lazy(() => import("./pages/Blog"));
const Post = lazy(() => import("./pages/Post"));

/** Client-only boot marker: "prerendered" when the app mounted over prerendered HTML. */
function useBootMarker() {
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-booted", html.hasAttribute("data-wfa-prerendered") ? "prerendered" : "fresh");
  }, []);
}

export function App() {
  useBootMarker();
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
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
      <Route path="/draft" element={<Draft />} />
      <Route path="/hidden" element={<Hidden />} />
      <Route path="/boom" element={<Boom />} />
    </Routes>
  );
}
