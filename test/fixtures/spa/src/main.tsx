import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { SeoProvider } from "../../../../src/index";
import { App } from "./App";

const base = import.meta.env.BASE_URL;

createRoot(document.getElementById("root")!).render(
  <SeoProvider defaults={{ siteName: "Fixture", siteUrl: "https://example.com" }}>
    <BrowserRouter basename={base.startsWith("/") ? base : "/"}>
      <App />
    </BrowserRouter>
  </SeoProvider>,
);
