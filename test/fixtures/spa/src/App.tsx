import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { About } from "./pages/About";
import { Blog } from "./pages/Blog";
import { Boom } from "./pages/Boom";
import { Draft } from "./pages/Draft";
import { Hidden } from "./pages/Hidden";
import { Home } from "./pages/Home";

const Post = lazy(() => import("./pages/Post"));

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/blog" element={<Blog />} />
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
