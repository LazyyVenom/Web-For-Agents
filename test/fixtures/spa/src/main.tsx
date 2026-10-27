import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { SeoProvider } from "../../../../src/index";
import { App } from "./App";
import "./main.css";

const base = import.meta.env.BASE_URL;
const siteUrl = (import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://example.com";

createRoot(document.getElementById("root")!).render(
  <SeoProvider defaults={{ siteName: "Fixture", siteUrl }}>
    <BrowserRouter basename={base.startsWith("/") ? base : "/"}>
      <App />
    </BrowserRouter>
  </SeoProvider>,
);
